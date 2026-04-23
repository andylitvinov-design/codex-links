import test from "node:test";
import assert from "node:assert/strict";

import { resolveRequestedDispatchMode } from "../functions/api/commands.js";

test("resolveRequestedDispatchMode preserves explicit Slack cloud routing for photo requests", () => {
  const dispatchMode = resolveRequestedDispatchMode({
    dispatchMode: "slack-codex-cloud",
    targetExecutionMode: "cloud-via-slack",
    photo: {
      contentType: "image/png",
      fileName: "photo.png",
      size: 128,
      dataUrl: "data:image/png;base64,AA=="
    }
  }, {
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_CODEX_CHANNEL_ID: "C123",
    OPENAI_API_KEY: "sk-test",
    COMMAND_DISPATCH_MODE: "cloud-via-slack"
  });

  assert.equal(dispatchMode, "slack-codex-cloud");
});

test("resolveRequestedDispatchMode routes photo cloud requests to Slack when direct cloud is unavailable", () => {
  const dispatchMode = resolveRequestedDispatchMode({
    dispatchMode: "cloud",
    photo: {
      dataUrl: "data:image/jpeg;base64,ZmFrZQ=="
    }
  }, {
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_CODEX_CHANNEL_ID: "C123",
    COMMAND_DISPATCH_MODE: "cloud-via-slack"
  });

  assert.equal(dispatchMode, "slack-codex-cloud");
});

test("resolveRequestedDispatchMode preserves explicit direct cloud opt-in for photo requests", () => {
  const dispatchMode = resolveRequestedDispatchMode({
    dispatchMode: "cloud",
    photo: {
      dataUrl: "data:image/jpeg;base64,ZmFrZQ=="
    }
  }, {
    OPENAI_API_KEY: "sk-test",
  });

  assert.equal(dispatchMode, "cloud");
});
