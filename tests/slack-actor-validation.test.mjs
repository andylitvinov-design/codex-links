import test from "node:test";
import assert from "node:assert/strict";

import { classifySlackReply, validateSlackCodexActor } from "../functions/_lib/slack.js";

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

test("validateSlackCodexActor rejects when target points to the Codex Links bot itself", async () => {
  const env = {
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_CODEX_CHANNEL_ID: "C123",
    SLACK_CODEX_USER_ID: "UBOT"
  };

  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("/api/auth.test")) {
      return createSlackOkResponse({ user_id: "UBOT" });
    }

    throw new Error(`Unexpected fetch: ${String(url)}`);
  };

  try {
    const result = await validateSlackCodexActor(env, { timeoutMs: 20, pollIntervalMs: 1 });
    assert.equal(result.validationStatus, "invalid");
    assert.equal(result.code, "codex_target_user_invalid");
    assert.match(result.message, /Codex Links sender app/);
    assert.match(result.detail, /OpenAI Codex Slack app/);
    assert.match(result.detail, /@Codex bot\/user ID/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("validateSlackCodexActor rejects channel members that never acknowledge the probe", async () => {
  const env = {
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_CODEX_CHANNEL_ID: "C123",
    SLACK_CODEX_USER_ID: "U999"
  };

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
    const result = await validateSlackCodexActor(env, {
      timeoutMs: 10,
      pollIntervalMs: 1,
      liveProbe: true
    });
    assert.equal(result.validationStatus, "unverified");
    assert.equal(result.code, "codex_target_actor_unverified");
  } finally {
    global.fetch = originalFetch;
  }
});

test("validateSlackCodexActor skips the live probe by default when membership is valid but no recent actor activity exists", async () => {
  const env = {
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_CODEX_CHANNEL_ID: "C123",
    SLACK_CODEX_USER_ID: "U999"
  };

  let probePosts = 0;
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
      probePosts += 1;
      throw new Error("Live probe should stay disabled by default.");
    }

    throw new Error(`Unexpected fetch: ${String(url)}`);
  };

  try {
    const result = await validateSlackCodexActor(env, {
      timeoutMs: 10,
      pollIntervalMs: 1
    });
    assert.equal(result.validationStatus, "unverified");
    assert.equal(result.code, "codex_target_actor_unverified");
    assert.equal(probePosts, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("validateSlackCodexActor does not validate the ChatGPT Codex account connection prompt", async () => {
  const env = {
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_CODEX_CHANNEL_ID: "C123",
    SLACK_CODEX_USER_ID: "U999"
  };

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
        messages: [{
          ts: "1712345678.000200",
          user: "U999",
          text: "To use Codex in the 'super' Slack workspace, connect to your ChatGPT Codex account. After connecting, tag Codex again to continue. Connect button"
        }]
      });
    }

    throw new Error(`Unexpected fetch: ${String(url)}`);
  };

  try {
    const result = await validateSlackCodexActor(env, {
      timeoutMs: 10,
      pollIntervalMs: 1
    });
    assert.equal(result.validationStatus, "unverified");
    assert.equal(result.code, "codex_target_actor_unverified");
  } finally {
    global.fetch = originalFetch;
  }
});

test("classifySlackReply marks the ChatGPT Codex account connection prompt as failed", () => {
  const result = classifySlackReply(
    "To use Codex in the 'super' Slack workspace, connect to your ChatGPT Codex account. After connecting, tag Codex again to continue. Connect button"
  );

  assert.equal(result.status, "failed");
  assert.equal(result.progressStage, "codex-account-not-connected");
});

test("validateSlackCodexActor ignores helper-only Slack replies during live probe", async () => {
  const env = {
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_CODEX_CHANNEL_ID: "C123",
    SLACK_CODEX_USER_ID: "U999"
  };

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
          { ts: "1712345678.000100", thread_ts: "1712345678.000100", text: "probe root" },
          {
            ts: "1712345678.000200",
            thread_ts: "1712345678.000100",
            user: "U999",
            text: "Image uploaded in this thread. File: <https://example.test/file|photo.png>. Acknowledge in this same thread before starting the work."
          }
        ]
      });
    }

    throw new Error(`Unexpected fetch: ${String(url)}`);
  };

  try {
    const result = await validateSlackCodexActor(env, {
      timeoutMs: 10,
      pollIntervalMs: 1,
      liveProbe: true
    });
    assert.equal(result.validationStatus, "unverified");
    assert.equal(result.code, "codex_target_actor_unverified");
  } finally {
    global.fetch = originalFetch;
  }
});

test("validateSlackCodexActor accepts a real worker ack in the probe thread", async () => {
  const env = {
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_CODEX_CHANNEL_ID: "C123",
    SLACK_CODEX_USER_ID: "U999"
  };

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
          { ts: "1712345678.000100", thread_ts: "1712345678.000100", text: "probe root" },
          {
            ts: "1712345678.000200",
            thread_ts: "1712345678.000100",
            user: "U999",
            text: "Проверяю и читаю файлы."
          }
        ]
      });
    }

    throw new Error(`Unexpected fetch: ${String(url)}`);
  };

  try {
    const result = await validateSlackCodexActor(env, {
      timeoutMs: 10,
      pollIntervalMs: 1,
      liveProbe: true
    });
    assert.equal(result.validationStatus, "validated");
    assert.equal(result.code, "");
    assert.equal(result.observedReply?.user, "U999");
  } finally {
    global.fetch = originalFetch;
  }
});

test("validateSlackCodexActor accepts recent channel activity from the configured actor", async () => {
  const env = {
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_CODEX_CHANNEL_ID: "C123",
    SLACK_CODEX_USER_ID: "U999"
  };

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
          {
            ts: "1712345678.000200",
            user: "U999",
            text: "Проверяю и готовлю фикc."
          }
        ]
      });
    }

    throw new Error(`Unexpected fetch: ${String(url)}`);
  };

  try {
    const result = await validateSlackCodexActor(env, {
      timeoutMs: 10,
      pollIntervalMs: 1
    });
    assert.equal(result.validationStatus, "validated");
    assert.equal(result.observedReply?.user, "U999");
    assert.match(result.observedReply?.text || "", /готовлю фик/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test("validateSlackCodexActor honors configured activity freshness window before probing", async () => {
  const env = {
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_CODEX_CHANNEL_ID: "C123",
    SLACK_CODEX_USER_ID: "U999",
    SLACK_ACTOR_ACTIVITY_FRESHNESS_MS: String(2 * 60 * 60 * 1000)
  };

  const originalDateNow = Date.now;
  const originalFetch = global.fetch;
  Date.now = () => 2 * 60 * 60 * 1000;
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
          {
            ts: "1000",
            user: "U999",
            text: "Проверяю и готовлю фикc."
          }
        ]
      });
    }

    throw new Error(`Unexpected fetch: ${String(url)}`);
  };

  try {
    const result = await validateSlackCodexActor(env, {
      timeoutMs: 10,
      pollIntervalMs: 1
    });
    assert.equal(result.validationStatus, "validated");
    assert.equal(result.observedReply?.user, "U999");
  } finally {
    Date.now = originalDateNow;
    global.fetch = originalFetch;
  }
});

test("validateSlackCodexActor reuses recent cached validation without running a live probe", async () => {
  const store = new Map();
  const nowMs = Date.parse("2026-04-23T15:20:00.000Z");
  const env = {
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_CODEX_CHANNEL_ID: "C123",
    SLACK_CODEX_USER_ID: "U999",
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
      }
    }
  };

  await env.LINKS_STORE.put("slack_actor_validation_cache:C123:U999", JSON.stringify({
    validationStatus: "validated",
    configuredUserId: "U999",
    lastValidatedAt: "2026-04-23T15:18:30.000Z",
    observedReply: {
      user: "U999",
      text: "Cached validation"
    }
  }));

  const originalDateNow = Date.now;
  const originalFetch = global.fetch;
  Date.now = () => nowMs;
  global.fetch = async (url) => {
    throw new Error(`Unexpected fetch: ${String(url)}`);
  };

  try {
    const result = await validateSlackCodexActor(env, {
      timeoutMs: 10,
      pollIntervalMs: 1
    });
    assert.equal(result.validationStatus, "validated");
    assert.equal(result.configuredUserId, "U999");
    assert.equal(result.observedReply?.user, "U999");
  } finally {
    Date.now = originalDateNow;
    global.fetch = originalFetch;
  }
});

test("validateSlackCodexActor reuses a recent unverified result without running a second live probe", async () => {
  const store = new Map();
  const env = {
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_CODEX_CHANNEL_ID: "C123",
    SLACK_CODEX_USER_ID: "U999",
    SLACK_ACTOR_PROBE_TIMEOUT_MS: "10",
    SLACK_ACTOR_PROBE_POLL_MS: "1",
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
      }
    }
  };

  let probePosts = 0;
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
      probePosts += 1;
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
    const first = await validateSlackCodexActor(env, {
      timeoutMs: 10,
      pollIntervalMs: 1,
      liveProbe: true
    });
    assert.equal(first.validationStatus, "unverified");
    assert.equal(probePosts, 1);

    const second = await validateSlackCodexActor(env, {
      timeoutMs: 10,
      pollIntervalMs: 1,
      liveProbe: true
    });
    assert.equal(second.validationStatus, "unverified");
    assert.equal(probePosts, 1);
  } finally {
    global.fetch = originalFetch;
  }
});
