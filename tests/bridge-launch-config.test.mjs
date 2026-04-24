import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const runScriptPath = new URL("../scripts/run-links-bridge.sh", import.meta.url);
const runClaudeScriptPath = new URL("../scripts/run-claude-bridge.sh", import.meta.url);
const installScriptPath = new URL("../scripts/install-bridge-launch-agent.sh", import.meta.url);
const installClaudeScriptPath = new URL("../scripts/install-claude-bridge-launch-agent.sh", import.meta.url);
const bridgeScriptPath = new URL("../scripts/bridge-codex-commands.mjs", import.meta.url);

test("run-links-bridge keeps the machine awake while the bridge is active", async () => {
  const source = await readFile(runScriptPath, "utf8");

  assert.match(source, /caffeinate -i env \\/);
  assert.match(source, /wait "\$\{BRIDGE_PID\}"/);
});

test("run-links-bridge starts thread sync in the background and passes explicit bridge mode env", async () => {
  const source = await readFile(runScriptPath, "utf8");

  assert.match(source, /scripts\/sync-codex-threads\.mjs >\/dev\/null 2>&1 &/);
  assert.match(source, /BRIDGE_EXECUTOR="codex"/);
  assert.match(source, /BRIDGE_DISPATCH_MODE="local-bridge"/);
});

test("run-claude-bridge falls back to .dev.vars when automation config is absent", async () => {
  const source = await readFile(runClaudeScriptPath, "utf8");

  assert.match(source, /DEV_VARS_FILE="\$\{ROOT\}\/\.dev\.vars"/);
  assert.match(source, /extract_from_dev_vars\(\)/);
  assert.match(source, /WRITE_TOKEN="\$\(extract_from_dev_vars LINKS_WRITE_TOKEN\)"/);
  assert.match(source, /caffeinate -i env \\/);
  assert.match(source, /BRIDGE_EXECUTOR="claude"/);
  assert.match(source, /BRIDGE_DISPATCH_MODE="claude-bridge"/);
});

test("install-bridge-launch-agent configures a short launchd throttle interval", async () => {
  const source = await readFile(installScriptPath, "utf8");

  assert.match(source, /<key>ThrottleInterval<\/key>\s*<integer>5<\/integer>/);
  assert.match(source, /run-links-bridge\.sh/);
  assert.match(source, /<key>CLAUDE_BIN<\/key>/);
  assert.match(source, /<key>BRIDGE_EXECUTOR<\/key>\s*<string>codex<\/string>/);
  assert.match(source, /<key>BRIDGE_DISPATCH_MODE<\/key>\s*<string>local-bridge<\/string>/);
});

test("install-claude-bridge-launch-agent uses the Claude runner and env", async () => {
  const source = await readFile(installClaudeScriptPath, "utf8");

  assert.match(source, /run-claude-bridge\.sh/);
  assert.match(source, /com\.andriilitvinov\.codex-links-claude-bridge/);
  assert.match(source, /<key>CLAUDE_BIN<\/key>/);
  assert.match(source, /<key>BRIDGE_EXECUTOR<\/key>\s*<string>claude<\/string>/);
  assert.match(source, /<key>BRIDGE_DISPATCH_MODE<\/key>\s*<string>claude-bridge<\/string>/);
});

test("bridge watchdog allows long-lived runs before forcing a restart", async () => {
  const source = await readFile(bridgeScriptPath, "utf8");

  assert.match(source, /const BRIDGE_RUN_TIMEOUT_MS = 6 \* 60 \* 60 \* 1000;/);
});

test("bridge loop runs delivery maintenance automatically on startup and interval", async () => {
  const source = await readFile(bridgeScriptPath, "utf8");

  assert.match(source, /await runDeliveryMaintenance\(\)\.catch/);
  assert.match(source, /setInterval\(\(\) => \{\s*void runDeliveryMaintenance\(\)\.catch/);
  assert.match(source, /const MAINTENANCE_INTERVAL_MS = 60 \* 1000;/);
});

test("bridge loop publishes periodic runner heartbeats so status does not go stale while the process stays alive", async () => {
  const source = await readFile(bridgeScriptPath, "utf8");

  assert.match(source, /const BRIDGE_STATUS_HEARTBEAT_MS = 30 \* 1000;/);
  assert.match(source, /const heartbeatTimer = setInterval\(\(\) => \{/);
  assert.match(source, /void publishBridgeStatus\(buildRunnerHeartbeatStatus\(\)\)\.catch/);
});

test("Claude bridge does not pass prompt as an --add-dir value", async () => {
  const source = await readFile(bridgeScriptPath, "utf8");

  assert.match(source, /"--add-dir",\s*cwd \|\| process\.cwd\(\)/);
  assert.doesNotMatch(source, /addDirArgs,\s*instructions/);
});

test("Claude bridge grants access to the temp photo directory when a local image is attached", async () => {
  const source = await readFile(bridgeScriptPath, "utf8");

  assert.match(source, /"--add-dir",\s*cwd \|\| process\.cwd\(\)/);
  assert.match(source, /photoPath \? \["--add-dir",\s*dirname\(photoPath\)\] : \[\]/);
});

test("bridge loop supports bounded in-flight workers instead of a strictly serial claim-execute loop", async () => {
  const source = await readFile(bridgeScriptPath, "utf8");

  assert.match(source, /const MAX_IN_FLIGHT_BRIDGE_TASKS = 2;/);
  assert.match(source, /const inFlightTasks = new Set\(\);/);
  assert.match(source, /textLaneTask/);
  assert.match(source, /generalLaneTask/);
  assert.match(source, /textOnly: true/);
});

test("bridge loop keeps retrying after claim timeouts instead of aborting the runner", async () => {
  const source = await readFile(bridgeScriptPath, "utf8");

  assert.match(source, /await appendBridgeErrorLog\("claimNextCommand\.loop", error/);
  assert.match(source, /await sleep\(IDLE_DRAIN_POLL_MS\);/);
  assert.match(source, /lane:\s*"text"/);
  assert.match(source, /lane:\s*"general"/);
});

test("bridge executor tolerates benign stdin warnings when Codex already produced usable output", async () => {
  const source = await readFile(bridgeScriptPath, "utf8");

  assert.match(source, /function shouldTreatCodexExecAsUsable\(error, result, prompt = ""\)/);
  assert.match(source, /text\.includes\("no stdin data received in 3s"\)/);
  assert.match(source, /if \(shouldTreatCodexExecAsUsable\(error, result, prompt\)\) \{\s*resolve\(result\);/);
});

test("bridge executor sends photos directly to Codex CLI without the script tty wrapper", async () => {
  const source = await readFile(bridgeScriptPath, "utf8");

  assert.match(source, /codexArgs\.push\("-i", photoPath\);/);
  assert.match(source, /spawnFileWithOutput\(codexBin, codexArgs,/);
  assert.match(source, /stdio:\s*\["ignore", "pipe", "pipe"\]/);
  assert.doesNotMatch(source, /\/usr\/bin\/script/);
});

test("Claude bridge sends prompts through stdin instead of relying on positional prompt parsing", async () => {
  const source = await readFile(bridgeScriptPath, "utf8");

  assert.match(source, /"--input-format",\s*"text"/);
  assert.match(source, /stdin:\s*instructions/);
  assert.match(source, /stdio:\s*\[stdinInput === null \? "ignore" : "pipe", "pipe", "pipe"\]/);
  assert.doesNotMatch(source, /"--",\s*instructions/);
});

test("bridge photo OCR skips optional Swift extraction when developer tools are unavailable", async () => {
  const source = await readFile(bridgeScriptPath, "utf8");

  assert.match(source, /function isDeveloperToolsUnavailableError\(error\)/);
  assert.match(source, /photoOcr\.skipped/);
  assert.match(source, /invalid active developer path/);
  assert.match(source, /missing xcrun/);
});

test("bridge executor falls back to immediate assistant text when the Codex output file is missing", async () => {
  const source = await readFile(bridgeScriptPath, "utf8");

  assert.match(source, /if \(readOutputError && !getImmediateAssistantText\(result, prompt\)\) \{/);
});

test("bridge runner guards the photo preparation phase with a dedicated timeout and progress stage", async () => {
  const source = await readFile(bridgeScriptPath, "utf8");

  assert.match(source, /const PHOTO_PREP_TIMEOUT_MS = 60 \* 1000;/);
  assert.match(source, /await updateProgress\(command\.id, "waiting-for-photo"/);
  assert.match(source, /lastDiagnosticCode: "bridge_waiting_photo"/);
  assert.match(source, /photoPhaseTimeout/);
});
