import test from "node:test";
import assert from "node:assert/strict";

import {
  DISPATCH_MODE_CLOUD,
  DISPATCH_MODE_LOCAL,
  DISPATCH_MODE_SLACK,
  getConfiguredDispatchMode,
  normalizeDispatchMode
} from "../functions/_lib/dispatch.js";

test("normalizeDispatchMode accepts slack and direct aliases", () => {
  assert.equal(normalizeDispatchMode("cloud-via-slack"), DISPATCH_MODE_SLACK);
  assert.equal(normalizeDispatchMode("slack-codex-cloud"), DISPATCH_MODE_SLACK);
  assert.equal(normalizeDispatchMode("direct-openai"), DISPATCH_MODE_CLOUD);
  assert.equal(normalizeDispatchMode("cloud"), DISPATCH_MODE_CLOUD);
});

test("getConfiguredDispatchMode prefers Slack by default when configured", () => {
  assert.equal(getConfiguredDispatchMode({
    SLACK_BOT_TOKEN: "x",
    SLACK_CODEX_CHANNEL_ID: "C123"
  }), DISPATCH_MODE_SLACK);
});

test("getConfiguredDispatchMode falls back from direct-openai to Slack when key is missing", () => {
  assert.equal(getConfiguredDispatchMode({
    COMMAND_DISPATCH_MODE: "direct-openai",
    SLACK_BOT_TOKEN: "x",
    SLACK_CODEX_CHANNEL_ID: "C123"
  }), DISPATCH_MODE_SLACK);
});

test("getConfiguredDispatchMode falls back to local bridge when nothing cloud-capable is configured", () => {
  assert.equal(getConfiguredDispatchMode({
    COMMAND_DISPATCH_MODE: "cloud-via-slack"
  }), DISPATCH_MODE_LOCAL);
});
