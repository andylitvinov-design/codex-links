import test from "node:test";
import assert from "node:assert/strict";

import { writeCommands, getCommandById } from "../functions/_lib/commands.js";
import { readMessages } from "../functions/_lib/messages.js";
import { syncSlackCommandReplies } from "../functions/api/commands.js";
import { buildSlackCommandPrompt } from "../functions/_lib/prompt-builder.js";
import { classifySlackReply } from "../functions/_lib/slack.js";

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

test("buildSlackCommandPrompt requires an exact repo ACK and repo context", () => {
  const prompt = buildSlackCommandPrompt({
    id: "cmd-links-ack",
    threadId: "links",
    threadLabel: "links",
    projectId: "links",
    projectLabel: "links",
    projectCategory: "myprojects",
    targetRepo: "andylitvinov-design/codex-links",
    targetRepoUrl: "https://github.com/andylitvinov-design/codex-links",
    targetWorkspacePath: "/Users/andriilitvinov/projects/MYPROJECTS/links",
    targetContextFiles: ["AGENTS.md", "README.md", "STATE.md"],
    text: "check routing"
  }, {
    SLACK_CODEX_MENTION: "<@U999>"
  });

  assert.match(prompt, /ACK repo=andylitvinov-design\/codex-links project=links command=cmd-links-ack/);
  assert.match(prompt, /Repository: andylitvinov-design\/codex-links/);
  assert.match(prompt, /Repository URL: https:\/\/github\.com\/andylitvinov-design\/codex-links/);
  assert.match(prompt, /Workspace path: \/Users\/andriilitvinov\/projects\/MYPROJECTS\/links/);
  assert.match(prompt, /AGENTS\.md -> README\.md -> STATE\.md/);
});

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

test("syncSlackCommandReplies keeps repo ACK without final answer non-terminal", async () => {
  const env = createMockEnv();
  const createdAt = new Date().toISOString();

  await writeCommands(env, [{
    id: "cmd-slack-ack-only",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    projectKey: "links",
    projectId: "links",
    targetRepo: "andylitvinov-design/codex-links",
    text: "fix routing metadata",
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
    { ts: "3001.000001", thread_ts: "3000.000001", user: "U123", text: "ACK repo=andylitvinov-design/codex-links project=links command=cmd-slack-ack-only" }
  ]);

  try {
    const command = await getCommandById(env, "cmd-slack-ack-only");
    const terminal = await syncSlackCommandReplies(env, command, { SLACK_CODEX_USER_ID: "U123" });
    assert.equal(terminal, false);
  } finally {
    global.fetch = originalFetch;
  }

  const updated = await getCommandById(env, "cmd-slack-ack-only");
  const messages = await readMessages(env);

  assert.equal(updated?.status, "processing");
  assert.equal(updated?.replyMatched, false);
  assert.equal(updated?.repoAckStatus, "validated");
  assert.equal(messages.length, 0);
});

test("syncSlackCommandReplies validates exact repo ACK", async () => {
  const env = createMockEnv();
  const createdAt = new Date().toISOString();

  await writeCommands(env, [{
    id: "cmd-slack-valid-ack",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    projectId: "links",
    targetRepo: "andylitvinov-design/codex-links",
    text: "fix the dialogs",
    createdAt,
    progressUpdatedAt: createdAt,
    dispatchMode: "slack-codex-cloud",
    requestedExecutor: "cloud-via-slack",
    actualExecutor: "cloud-via-slack",
    status: "dispatched",
    progressStage: "dispatched",
    slackChannelId: "C123",
    slackMessageTs: "1100.000001",
    slackThreadTs: "1100.000001",
    dispatchedAt: createdAt
  }]);

  const originalFetch = global.fetch;
  global.fetch = async () => createSlackResponse([
    { ts: "1100.000001", thread_ts: "1100.000001", text: "root task" },
    { ts: "1101.000001", thread_ts: "1100.000001", user: "U123", text: "ACK repo=andylitvinov-design/codex-links project=links command=cmd-slack-valid-ack\nПроверяю." }
  ]);

  try {
    const command = await getCommandById(env, "cmd-slack-valid-ack");
    await syncSlackCommandReplies(env, command, { SLACK_CODEX_USER_ID: "U123" });
  } finally {
    global.fetch = originalFetch;
  }

  const updated = await getCommandById(env, "cmd-slack-valid-ack");
  assert.equal(updated?.status, "processing");
  assert.equal(updated?.repoAckStatus, "validated");
  assert.equal(updated?.repoAckRepo, "andylitvinov-design/codex-links");
  assert.equal(updated?.repoAckProject, "links");
  assert.equal(updated?.repoAckCommand, "cmd-slack-valid-ack");
  assert.equal(updated?.repoAckWarning, "");
});

test("syncSlackCommandReplies warns on mismatched repo ACK", async () => {
  const env = createMockEnv();
  const createdAt = new Date().toISOString();

  await writeCommands(env, [{
    id: "cmd-slack-wrong-ack",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    projectId: "links",
    targetRepo: "andylitvinov-design/codex-links",
    text: "fix the dialogs",
    createdAt,
    progressUpdatedAt: createdAt,
    dispatchMode: "slack-codex-cloud",
    requestedExecutor: "cloud-via-slack",
    actualExecutor: "cloud-via-slack",
    status: "dispatched",
    progressStage: "dispatched",
    slackChannelId: "C123",
    slackMessageTs: "1200.000001",
    slackThreadTs: "1200.000001",
    dispatchedAt: createdAt
  }]);

  const originalFetch = global.fetch;
  global.fetch = async () => createSlackResponse([
    { ts: "1200.000001", thread_ts: "1200.000001", text: "root task" },
    { ts: "1201.000001", thread_ts: "1200.000001", user: "U123", text: "ACK repo=andylitvinov-design/other project=links command=cmd-slack-wrong-ack\nПроверяю." }
  ]);

  try {
    const command = await getCommandById(env, "cmd-slack-wrong-ack");
    await syncSlackCommandReplies(env, command, { SLACK_CODEX_USER_ID: "U123" });
  } finally {
    global.fetch = originalFetch;
  }

  const updated = await getCommandById(env, "cmd-slack-wrong-ack");
  assert.equal(updated?.status, "processing");
  assert.equal(updated?.repoAckStatus, "warning");
  assert.match(updated?.repoAckWarning || "", /Repo ACK mismatch/);
  assert.equal(updated?.lastDiagnosticCode, "repo_ack_warning");
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

test("classifySlackReply extracts structured production delivery block", () => {
  const result = classifySlackReply([
    "Done.",
    "COMMAND_ID: cmd-123",
    "PR_URL: https://github.com/example/repo/pull/42",
    "BRANCH: codex/fix-prod",
    "MERGE_COMMIT: abcdef1234567890",
    "LIVE_URL: https://example.pages.dev/",
    "VERIFY_STATUS: production-verified"
  ].join("\n"));

  assert.equal(result.status, "answered");
  assert.equal(result.prUrl, "https://github.com/example/repo/pull/42");
  assert.equal(result.branchName, "codex/fix-prod");
  assert.equal(result.mergeCommit, "abcdef1234567890");
  assert.equal(result.productionUrl, "https://example.pages.dev/");
  assert.equal(result.deliveryStatus, "production-verified");
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
