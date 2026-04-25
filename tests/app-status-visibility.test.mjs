import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appScriptPath = new URL("../public/app.js", import.meta.url);

test("delivery status is not suppressed solely because a non-terminal assistant reply exists", async () => {
  const source = await readFile(appScriptPath, "utf8");

  assert.doesNotMatch(source, /function getCommandDeliveryStatus\(command\)\s*\{\s*if \(hasAssistantReply\(command\?\.id, command\)\)\s*\{\s*return null;/);
  assert.match(source, /if \(status === "answered" \|\| status === "acked"\)/);
});

test("UI maps Slack actor validation failures to a visible diagnostic message", async () => {
  const source = await readFile(appScriptPath, "utf8");

  assert.match(source, /diagnosticCode === "codex_target_actor_unverified"/);
  assert.match(source, /задача не отправлена/i);
  assert.match(source, /diagnosticCode === "codex_target_user_invalid"/);
});

test("UI blocks degraded cloud routes instead of silently sending", async () => {
  const source = await readFile(appScriptPath, "utf8");

  assert.match(source, /function isRouteHealthy\(route\)/);
  assert.match(source, /Cloud route сейчас недоступен/);
  assert.match(source, /const dispatchMode = requestedDispatchMode;/);
  assert.doesNotMatch(source, /hasPhotoAttachment && requestedDispatchMode === "cloud"\s*\?\s*"bridge"/);
});

test("UI exposes route health and Slack diagnostic controls", async () => {
  const source = await readFile(appScriptPath, "utf8");

  assert.match(source, /function formatTimestamp\(value\)/);
  assert.match(source, /function renderRouteHealthPanel\(status = \{\}\)/);
  assert.match(source, /function runSlackDiagnostic\(\)/);
  assert.match(source, /action:\s*"slack-diagnostic"/);
  assert.match(source, /Slack actor:/);
  assert.match(source, /claude_photo_not_visible/);
});
