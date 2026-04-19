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
  assert.equal(normalizeDispatchMode("cloud-via-slack"), DISPATCH_MODE_CLOUD);
  assert.equal(normalizeDispatchMode("slack-codex-cloud"), DISPATCH_MODE_SLACK);
  assert.equal(normalizeDispatchMode("direct-openai"), DISPATCH_MODE_CLOUD);
  assert.equal(normalizeDispatchMode("cloud"), DISPATCH_MODE_CLOUD);
});

test("getConfiguredDispatchMode prefers trusted cloud when configured", () => {
  assert.equal(getConfiguredDispatchMode({
    CLOUD_BRIDGE_BASE_URL: "http://127.0.0.1:8788",
    CLOUD_BRIDGE_SHARED_SECRET: "secret"
  }), DISPATCH_MODE_CLOUD);
});

test("getConfiguredDispatchMode falls back from cloud aliases to local bridge when trusted bridge is missing", () => {
  assert.equal(getConfiguredDispatchMode({
    COMMAND_DISPATCH_MODE: "direct-openai",
  }), DISPATCH_MODE_LOCAL);
});

test("getConfiguredDispatchMode falls back to local bridge when nothing cloud-capable is configured", () => {
  assert.equal(getConfiguredDispatchMode({
    COMMAND_DISPATCH_MODE: "cloud-via-slack"
  }), DISPATCH_MODE_LOCAL);
});
