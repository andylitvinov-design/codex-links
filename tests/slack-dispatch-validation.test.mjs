import test from "node:test";
import assert from "node:assert/strict";

import { dispatchCommandIfNeeded } from "../functions/api/commands.js";
import { getCommandById, writeCommands } from "../functions/_lib/commands.js";
import { readBridgeStatus } from "../functions/_lib/status.js";

function createMockEnv() {
  const store = new Map();

  return {
    SLACK_BOT_TOKEN: "xoxb-test",
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

test("dispatchCommandIfNeeded still posts to Slack when the actor probe is unacknowledged but channel membership is valid", async () => {
  const env = createMockEnv();
  const createdAt = new Date().toISOString();

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
  global.fetch = async (url) => {
    if (String(url).includes("/api/auth.test")) {
      return createSlackOkResponse({ user_id: "UBOT" });
    }

    if (String(url).includes("/api/conversations.members")) {
      return createSlackOkResponse({ members: ["UBOT", "U999"] });
    }

    if (String(url).includes("/api/conversations.history")) {
      return createSlackOkResponse({ messages: [] });
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

    if (String(url).includes("/api/conversations.replies")) {
      return createSlackOkResponse({
        messages: [
          { ts: "1712345678.000100", thread_ts: "1712345678.000100", text: "probe root" }
        ]
      });
    }

    throw new Error(`Unexpected fetch: ${String(url)}`);
  };

  try {
    const command = await getCommandById(env, "cmd-slack-invalid-actor");
    const result = await dispatchCommandIfNeeded(env, command, env);

    assert.equal(result.ok, true);
    assert.equal(result.command.status, "dispatched");
    assert.equal(result.command.progressStage, "dispatched");
    assert.equal(result.command.dispatchMode, "slack-codex-cloud");
    assert.equal(result.command.slackChannelId, "C123");
    assert.equal(result.command.slackThreadTs, "1712345678.000100");

    const storedStatus = await readBridgeStatus(env);
    assert.equal(storedStatus.slackActor?.validationStatus, "unverified");
    assert.equal(storedStatus.slackActor?.configuredUserId, "U999");
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
