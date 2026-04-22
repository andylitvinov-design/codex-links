import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const runScriptPath = new URL("../scripts/run-links-bridge.sh", import.meta.url);
const installScriptPath = new URL("../scripts/install-bridge-launch-agent.sh", import.meta.url);
const bridgeScriptPath = new URL("../scripts/bridge-codex-commands.mjs", import.meta.url);

test("run-links-bridge keeps the machine awake while the bridge is active", async () => {
  const source = await readFile(runScriptPath, "utf8");

  assert.match(source, /caffeinate -i env \\/);
  assert.match(source, /wait "\$\{BRIDGE_PID\}"/);
});

test("install-bridge-launch-agent configures a short launchd throttle interval", async () => {
  const source = await readFile(installScriptPath, "utf8");

  assert.match(source, /<key>ThrottleInterval<\/key>\s*<integer>5<\/integer>/);
});

test("bridge watchdog allows long-lived runs before forcing a restart", async () => {
  const source = await readFile(bridgeScriptPath, "utf8");

  assert.match(source, /const BRIDGE_RUN_TIMEOUT_MS = 6 \* 60 \* 60 \* 1000;/);
});
