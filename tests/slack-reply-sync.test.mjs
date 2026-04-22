import test from "node:test";
import assert from "node:assert/strict";

import { writeCommands, getCommandById } from "../functions/_lib/commands.js";
import { readMessages } from "../functions/_lib/messages.js";
import { syncSlackCommandReplies } from "../functions/api/commands.js";

function createMockEnv() {
  const store = new Map();

  return {
    SLACK_BOT_TOKEN: "test-token",
    LINKS_STORE: {
      async get(key, type) {
        if (!store.has(key)) {
          return null;
        }

        const value = store.get(key);
        return type === "json" ? JSON.parse(value) : value;
      },
      async put(key, value) {
        store.set(key, String(value));
      },
      async delete(key) {
        store.delete(key);
      }
    }
  };
}

function createSlackResponse(messages) {
  return {
    ok: true,
    async json() {
      return {
        ok: true,
        messages
      };
    }
  };
}

test("syncSlackCommandReplies keeps progress-only Slack replies non-terminal", async () => {
  const env = createMockEnv();
  const createdAt = new Date().toISOString();

  await writeCommands(env, [{
    id: "cmd-slack-progress",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "fix the dialogs",
    createdAt,
    progressUpdatedAt: createdAt,
    dispatchMode: "slack-codex-cloud",
    requestedExecutor: "cloud-via-slack",
    actualExecutor: "cloud-via-slack",
    status: "dispatched",
    progressStage: "dispatched",
    slackChannelId: "C123",
    slackMessageTs: "1000.000001",
    slackThreadTs: "1000.000001",
    dispatchedAt: createdAt
  }]);

  const originalFetch = global.fetch;
  global.fetch = async () => createSlackResponse([
    { ts: "1000.000001", thread_ts: "1000.000001", text: "root task" },
    { ts: "1001.000001", thread_ts: "1000.000001", text: "Проверяю и читаю файлы." }
  ]);

  try {
    const command = await getCommandById(env, "cmd-slack-progress");
    await syncSlackCommandReplies(env, command, { SLACK_CODEX_USER_ID: "U123" });
  } finally {
    global.fetch = originalFetch;
  }

  const updated = await getCommandById(env, "cmd-slack-progress");
  const messages = await readMessages(env);

  assert.equal(updated?.status, "processing");
  assert.equal(updated?.replyMatched, false);
  assert.equal(updated?.replyMatchedBy, "");
  assert.equal(messages.length, 0);
});

test("syncSlackCommandReplies persists terminal Slack replies and marks them matched", async () => {
  const env = createMockEnv();
  const createdAt = new Date().toISOString();

  await writeCommands(env, [{
    id: "cmd-slack-done",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "fix the dialogs",
    createdAt,
    progressUpdatedAt: createdAt,
    dispatchMode: "slack-codex-cloud",
    requestedExecutor: "cloud-via-slack",
    actualExecutor: "cloud-via-slack",
    status: "processing",
    progressStage: "processing",
    slackChannelId: "C123",
    slackMessageTs: "2000.000001",
    slackThreadTs: "2000.000001",
    dispatchedAt: createdAt,
    firstAckAt: createdAt
  }]);

  const originalFetch = global.fetch;
  global.fetch = async () => createSlackResponse([
    { ts: "2000.000001", thread_ts: "2000.000001", text: "root task" },
    { ts: "2001.000001", thread_ts: "2000.000001", text: "Готово. PR: https://github.com/example/repo/pull/1" }
  ]);

  try {
    const command = await getCommandById(env, "cmd-slack-done");
    await syncSlackCommandReplies(env, command, { SLACK_CODEX_USER_ID: "U123" });
  } finally {
    global.fetch = originalFetch;
  }

  const updated = await getCommandById(env, "cmd-slack-done");
  const messages = await readMessages(env);

  assert.equal(updated?.status, "answered");
  assert.equal(updated?.replyMatched, true);
  assert.equal(updated?.replyMatchedBy, "thread");
  assert.equal(messages.length, 1);
  assert.match(messages[0]?.text || "", /PR:/);
});
