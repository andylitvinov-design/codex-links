import test from "node:test";
import assert from "node:assert/strict";

import { validateSlackCodexActor } from "../functions/_lib/slack.js";

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

test("validateSlackCodexActor accepts the configured bot sender route when target matches auth.test user_id", async () => {
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
    assert.equal(result.validationStatus, "validated");
    assert.equal(result.configuredUserId, "UBOT");
    assert.equal(result.observedReply?.user, "UBOT");
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
      pollIntervalMs: 1
    });
    assert.equal(result.validationStatus, "invalid");
    assert.equal(result.code, "codex_target_actor_unverified");
  } finally {
    global.fetch = originalFetch;
  }
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
      pollIntervalMs: 1
    });
    assert.equal(result.validationStatus, "invalid");
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
      pollIntervalMs: 1
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
