import test from "node:test";
import assert from "node:assert/strict";

import { resolveRequestedDispatchMode } from "../functions/api/commands.js";

test("resolveRequestedDispatchMode routes photo requests to local bridge even when Slack cloud was requested", () => {
  const runtimeConfig = {
    dispatchMode: "slack-codex-cloud",
    slackBotToken: "xoxb-test",
    slackChannelId: "C123",
    openAiApiKey: "sk-test"
  };

  const dispatchMode = resolveRequestedDispatchMode({
    dispatchMode: "slack-codex-cloud",
    requestedExecutor: "cloud-via-slack",
    photo: {
      dataUrl: "data:image/jpeg;base64,ZmFrZQ=="
    }
  }, runtimeConfig);

  assert.equal(dispatchMode, "local-bridge");
});

test("resolveRequestedDispatchMode preserves explicit direct cloud opt-in for photo requests", () => {
  const runtimeConfig = {
    dispatchMode: "slack-codex-cloud",
    OPENAI_API_KEY: "sk-test"
  };

  const dispatchMode = resolveRequestedDispatchMode({
    dispatchMode: "cloud",
    photo: {
      dataUrl: "data:image/jpeg;base64,ZmFrZQ=="
    }
  }, runtimeConfig);

  assert.equal(dispatchMode, "cloud");
});
