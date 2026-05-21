import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import {
  buildCommandPayload,
  createCodexCommand,
  handleTelegramUpdate,
  normalizeCommandText
} from "../scripts/openclaw-telegram-gateway.mjs";

function makeUpdate({ chatId = "123", text = "/codex fix bug", username = "andy", messageId = 42 } = {}) {
  return {
    update_id: 1001,
    message: {
      message_id: messageId,
      text,
      chat: { id: chatId, username },
      from: { username }
    }
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("normalizeCommandText accepts /codex task text", () => {
  assert.equal(normalizeCommandText("/codex fix bug"), "fix bug");
  assert.equal(normalizeCommandText("/openclaw fix bug"), "fix bug");
});

test("plain text is rejected when prefix is required", () => {
  assert.equal(normalizeCommandText("fix bug"), "");
});

test("unauthorized chat ID is skipped and does not create command", async () => {
  const calls = [];
  const result = await handleTelegramUpdate(makeUpdate({ chatId: "999" }), {
    token: "test-token",
    allowedChatIds: new Set(["123"]),
    env: {
      LINKS_WRITE_TOKEN: "write-secret",
      OPENCLAW_TELEGRAM_ALLOWED_CHAT_IDS: "123"
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ ok: true });
    }
  });

  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "unauthorized_chat");
  assert.equal(calls.length, 0);
});

test("authorized /codex message creates a Codex Links command with a safe payload", async () => {
  const calls = [];
  const result = await handleTelegramUpdate(makeUpdate(), {
    token: "test-token",
    allowedChatIds: new Set(["123"]),
    env: {
      LINKS_WRITE_TOKEN: "write-secret",
      CODEX_LINKS_BASE_URL: "https://codex-links.example",
      OPENCLAW_TELEGRAM_ALLOWED_CHAT_IDS: "123"
    },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).includes("/api/commands")) {
        return jsonResponse({ ok: true, command: { id: "cmd-1" } }, 201);
      }
      return jsonResponse({ ok: true, result: {} });
    }
  });

  assert.equal(result.status, "created");
  const commandCall = calls.find((call) => call.url === "https://codex-links.example/api/commands");
  assert.ok(commandCall);
  assert.equal(commandCall.options.headers["x-write-token"], "write-secret");
  const payload = JSON.parse(commandCall.options.body);
  assert.equal(payload.text, "fix bug");
  assert.equal(payload.clientId, "telegram:123");
  assert.equal(payload.threadId, "links");
  assert.equal(payload.projectId, "links");
  assert.equal(payload.source, "telegram-openclaw");
  assert.deepEqual(payload.telegram, {
    chatId: "123",
    messageId: "42",
    username: "andy"
  });
  assert.doesNotMatch(commandCall.options.body, /write-secret|TELEGRAM_BOT_TOKEN/);
});

test("missing write token returns needs_config and does not crash", async () => {
  const result = await createCodexCommand({
    taskText: "fix bug",
    chatId: "123",
    messageId: "42",
    username: "andy",
    env: {},
    fetchImpl: async () => {
      throw new Error("fetch should not be called without write token");
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "needs_config");
});

test("buildCommandPayload keeps Telegram metadata bounded and non-secret", () => {
  const payload = buildCommandPayload({
    taskText: "fix bug",
    chatId: "123",
    messageId: "42",
    username: "andy",
    dispatchMode: "cloud-via-slack"
  });
  assert.equal(payload.dispatchMode, "cloud-via-slack");
  assert.doesNotMatch(JSON.stringify(payload), /TOKEN|secret|123456:/i);
});

test("gateway does not exit immediately after startup when Telegram API verify is skipped", async () => {
  const child = spawn(process.execPath, ["scripts/openclaw-telegram-gateway.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TELEGRAM_BOT_TOKEN: "test-token",
      OPENCLAW_TELEGRAM_SKIP_API_VERIFY: "1",
      OPENCLAW_TELEGRAM_POLL_INTERVAL_MS: "250",
      OPENCLAW_TELEGRAM_ALLOWED_CHAT_IDS: "123"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let exited = false;
  child.on("exit", () => { exited = true; });
  await delay(400);
  assert.equal(exited, false);
  child.kill("SIGTERM");
  await delay(100);
});
