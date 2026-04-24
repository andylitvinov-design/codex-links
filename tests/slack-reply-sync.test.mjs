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
    { ts: "1001.000001", thread_ts: "1000.000001", user: "U123", text: "Проверяю и читаю файлы." }
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
  assert.ok(updated?.firstAckAt);
  assert.ok(updated?.slackAckObservedAt);
  assert.equal(updated?.replyMatched, false);
  assert.equal(updated?.replyMatchedBy, "");
  assert.equal(messages.length, 0);
});

test("syncSlackCommandReplies ignores helper-only Slack replies and does not mark first ack", async () => {
  const env = createMockEnv();
  const createdAt = new Date().toISOString();

  await writeCommands(env, [{
    id: "cmd-slack-helper-only",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "inspect photo",
    createdAt,
    progressUpdatedAt: createdAt,
    dispatchMode: "slack-codex-cloud",
    requestedExecutor: "cloud-via-slack",
    actualExecutor: "cloud-via-slack",
    status: "dispatched",
    progressStage: "dispatched",
    slackChannelId: "C123",
    slackMessageTs: "3000.000001",
    slackThreadTs: "3000.000001",
    dispatchedAt: createdAt
  }]);

  const originalFetch = global.fetch;
  global.fetch = async () => createSlackResponse([
    { ts: "3000.000001", thread_ts: "3000.000001", text: "root task" },
    { ts: "3001.000001", thread_ts: "3000.000001", user: "U123", text: "Image uploaded in this thread. File: <https://example.test/file|photo.png>. Acknowledge in this same thread before starting the work." }
  ]);

  try {
    const command = await getCommandById(env, "cmd-slack-helper-only");
    await syncSlackCommandReplies(env, command, { SLACK_CODEX_USER_ID: "U123" });
  } finally {
    global.fetch = originalFetch;
  }

  const updated = await getCommandById(env, "cmd-slack-helper-only");

  assert.equal(updated?.status, "dispatched");
  assert.equal(updated?.firstAckAt, "");
  assert.equal(updated?.slackAckObservedAt || "", "");
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
    { ts: "2001.000001", thread_ts: "2000.000001", user: "U123", text: "Готово. PR: https://github.com/example/repo/pull/1" }
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

test("syncSlackCommandReplies treats photo observation replies as terminal", async () => {
  const env = createMockEnv();
  const createdAt = new Date().toISOString();

  await writeCommands(env, [{
    id: "cmd-slack-photo-observed",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "Что на фото?",
    createdAt,
    progressUpdatedAt: createdAt,
    dispatchMode: "slack-codex-cloud",
    requestedExecutor: "cloud-via-slack",
    actualExecutor: "cloud-via-slack",
    status: "processing",
    progressStage: "processing",
    slackChannelId: "C123",
    slackMessageTs: "4000.000001",
    slackThreadTs: "4000.000001",
    dispatchedAt: createdAt,
    firstAckAt: createdAt,
    photoAttached: true,
    photoBytesPresent: true
  }]);

  const originalFetch = global.fetch;
  global.fetch = async () => createSlackResponse([
    { ts: "4000.000001", thread_ts: "4000.000001", text: "root task" },
    { ts: "4001.000001", thread_ts: "4000.000001", user: "U123", text: "Observed: на скриншоте видна ошибка tcgetattr/ioctl." }
  ]);

  try {
    const command = await getCommandById(env, "cmd-slack-photo-observed");
    await syncSlackCommandReplies(env, command, { SLACK_CODEX_USER_ID: "U123" });
  } finally {
    global.fetch = originalFetch;
  }

  const updated = await getCommandById(env, "cmd-slack-photo-observed");
  const messages = await readMessages(env);

  assert.equal(updated?.status, "answered");
  assert.equal(updated?.replyMatched, true);
  assert.equal(updated?.replyMatchedBy, "thread");
  assert.equal(messages.length, 1);
  assert.match(messages[0]?.text || "", /^Observed:/);
});

test("syncSlackCommandReplies treats PHOTO_OK smoke replies as terminal", async () => {
  const env = createMockEnv();
  const createdAt = new Date().toISOString();

  await writeCommands(env, [{
    id: "cmd-slack-photo-ok",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "photo cloud probe ignore",
    createdAt,
    progressUpdatedAt: createdAt,
    dispatchMode: "slack-codex-cloud",
    requestedExecutor: "cloud-via-slack",
    actualExecutor: "cloud-via-slack",
    status: "processing",
    progressStage: "processing",
    slackChannelId: "C123",
    slackMessageTs: "5000.000001",
    slackThreadTs: "5000.000001",
    dispatchedAt: createdAt,
    firstAckAt: createdAt,
    photoAttached: true,
    photoBytesPresent: true
  }]);

  const originalFetch = global.fetch;
  global.fetch = async () => createSlackResponse([
    { ts: "5000.000001", thread_ts: "5000.000001", text: "root task" },
    { ts: "5001.000001", thread_ts: "5000.000001", user: "U123", text: "PHOTO_OK" }
  ]);

  try {
    const command = await getCommandById(env, "cmd-slack-photo-ok");
    await syncSlackCommandReplies(env, command, { SLACK_CODEX_USER_ID: "U123" });
  } finally {
    global.fetch = originalFetch;
  }

  const updated = await getCommandById(env, "cmd-slack-photo-ok");

  assert.equal(updated?.status, "answered");
  assert.equal(updated?.replyMatched, true);
});

test("syncSlackCommandReplies recognizes Codex replies by bot profile user id", async () => {
  const env = createMockEnv();
  const createdAt = new Date().toISOString();

  await writeCommands(env, [{
    id: "cmd-slack-photo-bot-profile",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "photo cloud probe ignore",
    createdAt,
    progressUpdatedAt: createdAt,
    dispatchMode: "slack-codex-cloud",
    requestedExecutor: "cloud-via-slack",
    actualExecutor: "cloud-via-slack",
    status: "processing",
    progressStage: "waiting-slack-photo-reply",
    slackChannelId: "C123",
    slackMessageTs: "6000.000001",
    slackThreadTs: "6000.000001",
    dispatchedAt: createdAt,
    photoAttached: true,
    photoBytesPresent: true,
    slackPhotoUploadCompletedAt: createdAt
  }]);

  const originalFetch = global.fetch;
  global.fetch = async () => createSlackResponse([
    { ts: "6000.000001", thread_ts: "6000.000001", text: "root task" },
    {
      ts: "6001.000001",
      thread_ts: "6000.000001",
      bot_id: "B123",
      bot_profile: { user_id: "U123" },
      text: "PHOTO_OK"
    }
  ]);

  try {
    const command = await getCommandById(env, "cmd-slack-photo-bot-profile");
    await syncSlackCommandReplies(env, command, { SLACK_CODEX_USER_ID: "U123" });
  } finally {
    global.fetch = originalFetch;
  }

  const updated = await getCommandById(env, "cmd-slack-photo-bot-profile");
  const messages = await readMessages(env);

  assert.equal(updated?.status, "answered");
  assert.equal(updated?.actualExecutor, "cloud-via-slack");
  assert.equal(updated?.replyMatched, true);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.text, "PHOTO_OK");
});
