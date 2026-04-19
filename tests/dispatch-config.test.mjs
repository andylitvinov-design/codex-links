import test from "node:test";
import assert from "node:assert/strict";

import {
  DISPATCH_MODE_CLOUD,
  DISPATCH_MODE_LOCAL,
  DISPATCH_MODE_SLACK,
  getConfiguredDispatchMode,
  normalizeDispatchMode
} from "../functions/_lib/dispatch.js";
import { onRequest } from "../functions/api/commands.js";

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

test("photo command respects slack-only cloud mode even when OPENAI_API_KEY exists", async () => {
  const request = new Request("https://example.com/api/commands", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      clientId: "test-client",
      threadId: "links",
      threadLabel: "links",
      text: "Что на фото?",
      dispatchMode: "cloud",
      targetExecutionMode: "cloud",
      targetRepo: "andylitvinov-design/codex-links",
      photo: {
        fileName: "photo.jpg",
        contentType: "image/jpeg",
        size: 1234,
        dataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/"
      }
    })
  });

  const store = new Map();
  const env = {
    COMMAND_DISPATCH_MODE: "cloud-via-slack",
    OPENAI_API_KEY: "should-not-be-used",
    SLACK_BOT_TOKEN: "x",
    SLACK_CODEX_CHANNEL_ID: "C123",
    LINKS_STORE: {
      async get(key) {
        return store.has(key) ? JSON.parse(store.get(key)) : null;
      },
      async put(key, value) {
        store.set(key, value);
      }
    }
  };

  const response = await onRequest({
    request,
    env,
    waitUntil() {}
  });
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.command.dispatchMode, DISPATCH_MODE_SLACK);
});
