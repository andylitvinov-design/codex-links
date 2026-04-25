import test from "node:test";
import assert from "node:assert/strict";

import {
  DISPATCH_MODE_CLOUD,
  DISPATCH_MODE_CLAUDE,
  DISPATCH_MODE_LOCAL,
  DISPATCH_MODE_SLACK,
  EXECUTOR_ROUTE_BRIDGE,
  EXECUTOR_ROUTE_CLAUDE,
  EXECUTOR_ROUTE_CLOUD_SLACK,
  EXECUTOR_ROUTE_DIRECT_OPENAI,
  dispatchModeToExecutorRoute,
  executorRouteToDispatchMode,
  getConfiguredDispatchMode,
  getSlackCodexMention,
  normalizeDispatchMode,
  normalizeExecutorRoute
} from "../functions/_lib/dispatch.js";

test("normalizeDispatchMode accepts slack and direct aliases", () => {
  assert.equal(normalizeDispatchMode("cloud-via-slack"), DISPATCH_MODE_SLACK);
  assert.equal(normalizeDispatchMode("slack-codex-cloud"), DISPATCH_MODE_SLACK);
  assert.equal(normalizeDispatchMode("direct-openai"), DISPATCH_MODE_CLOUD);
  assert.equal(normalizeDispatchMode("cloud"), DISPATCH_MODE_CLOUD);
  assert.equal(normalizeDispatchMode("claude"), DISPATCH_MODE_CLAUDE);
});

test("executor route helpers preserve explicit route choices", () => {
  assert.equal(normalizeExecutorRoute("bridge"), EXECUTOR_ROUTE_BRIDGE);
  assert.equal(normalizeExecutorRoute("cloud"), EXECUTOR_ROUTE_DIRECT_OPENAI);
  assert.equal(normalizeExecutorRoute("cloud-via-slack"), EXECUTOR_ROUTE_CLOUD_SLACK);
  assert.equal(normalizeExecutorRoute("claude"), EXECUTOR_ROUTE_CLAUDE);
  assert.equal(executorRouteToDispatchMode(EXECUTOR_ROUTE_DIRECT_OPENAI), DISPATCH_MODE_CLOUD);
  assert.equal(executorRouteToDispatchMode(EXECUTOR_ROUTE_CLOUD_SLACK), DISPATCH_MODE_SLACK);
  assert.equal(executorRouteToDispatchMode(EXECUTOR_ROUTE_CLAUDE), DISPATCH_MODE_CLAUDE);
  assert.equal(dispatchModeToExecutorRoute(DISPATCH_MODE_CLAUDE), EXECUTOR_ROUTE_CLAUDE);
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

test("getSlackCodexMention prefers the configured target user id over a stale explicit mention", () => {
  assert.equal(getSlackCodexMention({
    SLACK_CODEX_MENTION: "<@U0AT5L4634J>",
    SLACK_CODEX_USER_ID: "U0B0H405MFA"
  }), "<@U0B0H405MFA>");
});
