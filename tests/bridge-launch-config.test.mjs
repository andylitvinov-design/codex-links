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

test("Claude bridge passes prompt after -- so --add-dir does not consume it", async () => {
  const source = await readFile(bridgeScriptPath, "utf8");

  assert.match(source, /"--",\s*instructions/);
});
