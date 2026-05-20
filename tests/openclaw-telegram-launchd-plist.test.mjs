import test from "node:test";
import assert from "node:assert/strict";

import {
  LAUNCH_LABEL,
  buildPlist,
  parseLaunchdStatus,
  redact
} from "../scripts/openclaw-telegram-launchd.mjs";

test("generated LaunchAgent plist has correct label and no token material", () => {
  const plist = buildPlist();
  assert.match(plist, new RegExp(`<string>${LAUNCH_LABEL}</string>`));
  assert.match(plist, /openclaw-telegram-gateway\.mjs/);
  assert.match(plist, /WorkingDirectory/);
  assert.doesNotMatch(plist, /TELEGRAM_BOT_TOKEN/);
  assert.doesNotMatch(plist, /\d{6,}:[A-Za-z0-9_-]{20,}/);
});

test("launchctl print parser detects running pid", () => {
  const status = parseLaunchdStatus({
    ok: true,
    stdout: "state = running\npid = 12345\n",
    stderr: ""
  });
  assert.equal(status.installed, true);
  assert.equal(status.running, true);
  assert.equal(status.pid, 12345);
  assert.equal(status.state, "running");
});

test("launchctl print parser detects missing service", () => {
  const status = parseLaunchdStatus({
    ok: false,
    stdout: "",
    stderr: "Could not find service"
  });
  assert.equal(status.installed, false);
  assert.equal(status.running, false);
  assert.equal(status.pid, 0);
  assert.equal(status.state, "missing");
});

test("redaction hides Telegram bot token patterns", () => {
  const token = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef";
  const output = redact(`TELEGRAM_BOT_TOKEN=${token} Bot token: ${token}`);
  assert.doesNotMatch(output, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(output, /\[REDACTED/);
});
