import test from "node:test";
import assert from "node:assert/strict";

import { dispatchCommandIfNeeded } from "../functions/api/commands.js";
import { getCommandById, writeCommands } from "../functions/_lib/commands.js";
import { readBridgeStatus } from "../functions/_lib/status.js";

function createMockEnv() {
  const store = new Map();

  return {
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_CODEX_DISPATCH_TOKEN: "xoxp-human",
    SLACK_CODEX_CHANNEL_ID: "C123",
    SLACK_CODEX_USER_ID: "U999",
    SLACK_ACTOR_PROBE_TIMEOUT_MS: "100",
    SLACK_ACTOR_PROBE_POLL_MS: "1",
    COMMAND_DISPATCH_MODE: "cloud-via-slack",
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

function createSlackOkResponse(body) {
  return {
    ok: true,
    async json() {
      return {
        ok: true,
        ...body
      };
    }
  };
}

test("dispatchCommandIfNeeded falls back when the human Slack dispatch token is missing", async () => {
  const env = createMockEnv();
  delete env.SLACK_CODEX_DISPATCH_TOKEN;
  const createdAt = new Date().toISOString();

  await writeCommands(env, [{
    id: "cmd-slack-missing-human-token",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "fix the dialogs",
    createdAt,
    progressUpdatedAt: createdAt,
    dispatchMode: "slack-codex-cloud",
    requestedExecutor: "cloud-via-slack",
    actualExecutor: "",
    status: "queued",
    progressStage: "queued"
  }]);

  const command = await getCommandById(env, "cmd-slack-missing-human-token");
  const result = await dispatchCommandIfNeeded(env, command, env);

  assert.equal(result.ok, true);
  assert.equal(result.command.status, "failed");
  assert.equal(result.command.dispatchMode, "slack-codex-cloud");
  assert.equal(result.command.actualExecutor, "cloud-via-slack");
  assert.equal(result.command.slackDispatchAttempted, false);
  assert.match(result.command.errorMessage, /SLACK_CODEX_DISPATCH_TOKEN/);
});

test("dispatchCommandIfNeeded falls back when the actor probe is unacknowledged", async () => {
  const env = createMockEnv();
  const createdAt = new Date().toISOString();
  const authByMethod = new Map();

  await writeCommands(env, [{
    id: "cmd-slack-invalid-actor",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "fix the dialogs",
    createdAt,
    progressUpdatedAt: createdAt,
    dispatchMode: "slack-codex-cloud",
    requestedExecutor: "cloud-via-slack",
    actualExecutor: "",
    status: "queued",
    progressStage: "queued"
  }]);

  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const method = String(url).split("/api/").at(1) || String(url);
    const authorization = String(options?.headers?.authorization || options?.headers?.Authorization || "");
    authByMethod.set(method, authorization);

    if (String(url).includes("/api/auth.test")) {
      return createSlackOkResponse({ user_id: "UBOT" });
    }

    if (String(url).includes("/api/conversations.members")) {
      return createSlackOkResponse({ members: ["UBOT", "U999"] });
    }

    if (String(url).includes("/api/conversations.history")) {
      return createSlackOkResponse({ messages: [] });
    }

    throw new Error(`Unexpected fetch: ${String(url)}`);
  };

  try {
    const command = await getCommandById(env, "cmd-slack-invalid-actor");
    const result = await dispatchCommandIfNeeded(env, command, env);

    assert.equal(result.ok, true);
    assert.equal(result.command.status, "queued");
    assert.equal(result.command.progressStage, "queued");
    assert.equal(result.command.dispatchMode, "local-bridge");
    assert.equal(result.command.actualExecutor, "bridge");
    assert.equal(result.command.lastDiagnosticCode, "codex_target_actor_unverified");

    const storedStatus = await readBridgeStatus(env);
    assert.notEqual(storedStatus.slackActor?.validationStatus, "validated");
  } finally {
    global.fetch = originalFetch;
  }
});

test("dispatchCommandIfNeeded requeues manifest-backed Slack photo upload failures to Claude bridge", async () => {
  const env = createMockEnv();
  const createdAt = new Date().toISOString();

  await writeCommands(env, [{
    id: "cmd-slack-photo-upload-fallback",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "Что на фото?",
    createdAt,
    progressUpdatedAt: createdAt,
    dispatchMode: "slack-codex-cloud",
    requestedExecutor: "cloud-via-slack",
    actualExecutor: "",
    status: "queued",
    progressStage: "queued",
    photo: {
      contentType: "image/png",
      fileName: "photo.png",
      size: 4,
      dataUrl: "data:image/png;base64,AAAAAA=="
    },
    photoAttached: true,
    photoBytesPresent: true,
    targetRepo: "andylitvinov-design/codex-links",
    targetRepoUrl: "https://github.com/andylitvinov-design/codex-links",
    targetWorkspacePath: "/workspace/links",
    targetContextFiles: ["AGENTS.md", "README.md", "STATE.md"],
    allowClaudeFallback: true
  }]);

  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("/api/auth.test")) {
      return createSlackOkResponse({ user_id: "UBOT" });
    }

    if (String(url).includes("/api/conversations.members")) {
      return createSlackOkResponse({ members: ["UBOT", "U999"] });
    }

    if (String(url).includes("/api/conversations.history")) {
      return createSlackOkResponse({
        messages: [
          { ts: "1712345678.000050", user: "U999", text: "Ready for cloud work." }
        ]
      });
    }

    if (String(url).includes("/api/conversations.replies")) {
      return createSlackOkResponse({
        messages: [
          { ts: "1712345678.000100", thread_ts: "1712345678.000100", text: "probe root" },
          { ts: "1712345678.000200", thread_ts: "1712345678.000100", user: "U999", text: "Проверяю." }
        ]
      });
    }

    if (String(url).includes("/api/chat.postMessage")) {
      return createSlackOkResponse({
        channel: "C123",
        ts: "1712345678.000100",
        message: {
          ts: "1712345678.000100",
          thread_ts: "1712345678.000100"
        }
      });
    }

    if (String(url).includes("/api/files.getUploadURLExternal")) {
      return {
        ok: true,
        async json() {
          return { ok: false, error: "temporarily_unavailable" };
        }
      };
    }

    throw new Error(`Unexpected fetch: ${String(url)}`);
  };

  try {
    const command = await getCommandById(env, "cmd-slack-photo-upload-fallback");
    const result = await dispatchCommandIfNeeded(env, command, env);

    assert.equal(result.ok, true);
    assert.equal(result.command.status, "queued");
    assert.equal(result.command.dispatchMode, "claude-bridge");
    assert.equal(result.command.progressStage, "fallback-to-claude");
    assert.equal(result.command.lastDiagnosticCode, "slack_photo_upload_failed");
    assert.equal(result.command.actualExecutor, "claude");
    assert.match(result.command.errorMessage, /fallback_to_claude/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("dispatchCommandIfNeeded does not repost an already dispatched Slack command", async () => {
  const env = createMockEnv();
  const createdAt = new Date().toISOString();

  await writeCommands(env, [{
    id: "cmd-slack-already-dispatched",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "fix the dialogs",
    createdAt,
    progressUpdatedAt: createdAt,
    dispatchMode: "slack-codex-cloud",
    requestedExecutor: "cloud-via-slack",
    actualExecutor: "",
    status: "dispatched",
    progressStage: "dispatched",
    slackChannelId: "C123",
    slackMessageTs: "1712345678.000100",
    slackThreadTs: "1712345678.000100",
    dispatchedAt: createdAt
  }]);

  let postMessageCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("/api/conversations.history")) {
      return createSlackOkResponse({ messages: [] });
    }

    if (String(url).includes("/api/conversations.replies")) {
      return createSlackOkResponse({
        messages: [
          { ts: "1712345678.000100", thread_ts: "1712345678.000100", text: "root task" }
        ]
      });
    }

    if (String(url).includes("/api/chat.postMessage")) {
      postMessageCalls += 1;
      return createSlackOkResponse({
        channel: "C123",
        ts: "1712345678.000100",
        message: {
          ts: "1712345678.000100",
          thread_ts: "1712345678.000100"
        }
      });
    }

    throw new Error(`Unexpected fetch: ${String(url)}`);
  };

  try {
    const command = await getCommandById(env, "cmd-slack-already-dispatched");
    const result = await dispatchCommandIfNeeded(env, command, env);

    assert.equal(result.ok, true);
    assert.equal(result.command.status, "dispatched");
    assert.equal(result.command.slackThreadTs, "1712345678.000100");
    assert.equal(postMessageCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("dispatchCommandIfNeeded does not repost a Slack command that is already dispatching", async () => {
  const env = createMockEnv();
  const createdAt = new Date().toISOString();

  await writeCommands(env, [{
    id: "cmd-slack-dispatching",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "fix the dialogs",
    createdAt,
    progressUpdatedAt: createdAt,
    dispatchMode: "slack-codex-cloud",
    requestedExecutor: "cloud-via-slack",
    actualExecutor: "",
    status: "queued",
    progressStage: "dispatching",
    dispatchStartedAt: createdAt
  }]);

  let postMessageCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("/api/chat.postMessage")) {
      postMessageCalls += 1;
      throw new Error("Dispatch should not be re-posted while the first attempt is still in flight.");
    }

    throw new Error(`Unexpected fetch: ${String(url)}`);
  };

  try {
    const staleCommandSnapshot = {
      id: "cmd-slack-dispatching",
      clientId: "test-client",
      threadId: "links",
      threadLabel: "links",
      text: "fix the dialogs",
      createdAt,
      progressUpdatedAt: createdAt,
      dispatchMode: "slack-codex-cloud",
      requestedExecutor: "cloud-via-slack",
      actualExecutor: "",
      status: "queued",
      progressStage: "queued"
    };
    const result = await dispatchCommandIfNeeded(env, staleCommandSnapshot, env);

    assert.equal(result.ok, true);
    assert.equal(result.command.progressStage, "dispatching");
    assert.equal(result.command.slackThreadTs, "");
    assert.equal(postMessageCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});
