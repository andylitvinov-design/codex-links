#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import process from "node:process";

const DEFAULT_BASE_URL = "https://codex-links.pages.dev";
const DEFAULT_HEARTBEAT_MS = 60_000;
const DEFAULT_POLL_TIMEOUT_SECONDS = 25;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const GATEWAY_VERSION = "2026-05-22-menu-v1";
const STATE_DIR = join(homedir(), "Library", "Application Support", "openclaw-telegram-gateway");
const STATE_PATH = join(STATE_DIR, "state.json");
const TELEGRAM_BOT_COMMANDS = [
  { command: "start", description: "Show welcome and available commands" },
  { command: "help", description: "Show command list and examples" },
  { command: "status", description: "Show gateway status" },
  { command: "codex", description: "Create a Codex Links command" },
  { command: "vault", description: "Show local Secret Vault URL" },
  { command: "projects", description: "Show supported projects" },
  { command: "version", description: "Show gateway version" }
];

function redact(value = "") {
  return String(value)
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_TELEGRAM_BOT_TOKEN]")
    .replace(/(TELEGRAM_BOT_TOKEN=)[^\s]+/g, "$1[REDACTED]")
    .replace(/(LINKS_WRITE_TOKEN=)[^\s]+/g, "$1[REDACTED]")
    .replace(/(CODEX_LINKS_WRITE_TOKEN=)[^\s]+/g, "$1[REDACTED]")
    .replace(/(Bot token:\s*)[^\s]+/gi, "$1[REDACTED]");
}

function log(event, details = {}) {
  const safe = JSON.stringify({
    ts: new Date().toISOString(),
    service: "openclaw-telegram-gateway",
    event,
    ...details
  }, (_, value) => typeof value === "string" ? redact(value) : value);
  console.log(safe);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseAllowedChatIds(value = "") {
  return new Set(String(value || "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean));
}

function isAllowedChat(chatId, allowedChatIds) {
  return allowedChatIds.has(String(chatId || "").trim());
}

function normalizeCommandText(text = "") {
  const normalized = String(text || "").trim();
  const match = normalized.match(/^\/(?:codex|openclaw)(?:@\w+)?(?:\s+([\s\S]+))?$/i);
  if (!match) return "";
  return String(match[1] || "").trim();
}

function getTelegramCommand(text = "") {
  const match = String(text || "").trim().match(/^\/([a-z0-9_]+)(?:@\w+)?(?:\s+|$)/i);
  return match ? match[1].toLowerCase() : "";
}

function isCommand(text = "", command = "") {
  return getTelegramCommand(text) === String(command || "").toLowerCase();
}

function getWriteToken(env = process.env) {
  return String(env.LINKS_WRITE_TOKEN || env.CODEX_LINKS_WRITE_TOKEN || "").trim();
}

function getBaseUrl(env = process.env) {
  return String(env.CODEX_LINKS_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
}

function getTelegramApiBase(token) {
  return `https://api.telegram.org/bot${token}`;
}

async function requestJson(url, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, options);
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { response, text, data };
}

async function verifyTelegramToken(token, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  if (!token) return { ok: false, status: "missing_token", description: "TELEGRAM_BOT_TOKEN is not present in process env." };
  if (process.env.OPENCLAW_TELEGRAM_SKIP_API_VERIFY === "1" || options.skipApiVerify) {
    return { ok: true, status: "skipped", description: "Telegram API verification skipped." };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const { response, text, data } = await requestJson(`${getTelegramApiBase(token)}/getMe`, {
      method: "GET",
      signal: controller.signal
    }, fetchImpl);
    if (!response.ok || !data?.ok) {
      return {
        ok: false,
        status: "telegram_api_error",
        httpStatus: response.status,
        description: redact(data?.description || text.slice(0, 200) || "Telegram API returned an error.")
      };
    }
    return {
      ok: true,
      status: "telegram_api_ok",
      botUsername: data.result?.username || "unknown"
    };
  } catch (error) {
    return {
      ok: false,
      status: "telegram_api_unreachable",
      description: redact(error?.message || String(error))
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readState(statePath = STATE_PATH) {
  try {
    const data = JSON.parse(await readFile(statePath, "utf8"));
    const offset = Number(data?.offset || 0);
    return { offset: Number.isFinite(offset) && offset > 0 ? offset : 0 };
  } catch {
    return { offset: 0 };
  }
}

async function writeState(state, statePath = STATE_PATH) {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify({ offset: Number(state?.offset || 0) }, null, 2), "utf8");
}

async function sendTelegramMessage({ token, chatId, text, fetchImpl = fetch }) {
  if (!token || !chatId || !text) return { ok: false, status: "skipped" };
  const { response, data, text: bodyText } = await requestJson(`${getTelegramApiBase(token)}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true
    })
  }, fetchImpl);
  return {
    ok: response.ok && data?.ok !== false,
    status: response.ok ? "sent" : "telegram_api_error",
    httpStatus: response.status,
    description: redact(data?.description || bodyText.slice(0, 160) || "")
  };
}

async function setTelegramBotCommands({ token, fetchImpl = fetch }) {
  if (!token) return { ok: false, status: "skipped", reason: "missing_token" };
  if (process.env.OPENCLAW_TELEGRAM_SKIP_SET_COMMANDS === "1") {
    return { ok: true, status: "skipped" };
  }
  const { response, data, text } = await requestJson(`${getTelegramApiBase(token)}/setMyCommands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ commands: TELEGRAM_BOT_COMMANDS })
  }, fetchImpl);
  return {
    ok: response.ok && data?.ok !== false,
    status: response.ok ? "configured" : "telegram_api_error",
    httpStatus: response.status,
    description: redact(data?.description || text.slice(0, 160) || "")
  };
}

function buildWelcomeText() {
  return [
    "Codex Links Telegram gateway is running.",
    "",
    "Commands:",
    "/help - command list and examples",
    "/status - gateway status",
    "/codex <task> - create a Codex Links command",
    "/vault - local Secret Vault link",
    "/projects - supported projects",
    "/version - gateway version"
  ].join("\n");
}

function buildHelpText() {
  return [
    "Codex Links commands:",
    "/start - welcome",
    "/help - this help",
    "/status - gateway status",
    "/codex <task> - create a Codex Links command",
    "/vault - local Secret Vault info",
    "/projects - supported/default project",
    "/version - gateway metadata",
    "",
    "Examples:",
    "/codex check issue #160",
    "/codex summarize latest delivery status"
  ].join("\n");
}

function buildStatusText({ env = process.env } = {}) {
  return [
    "running",
    `baseUrl=${getBaseUrl(env)}`,
    `writeTokenConfigured=${Boolean(getWriteToken(env))}`,
    `allowedChatCount=${parseAllowedChatIds(env.OPENCLAW_TELEGRAM_ALLOWED_CHAT_IDS).size}`
  ].join("\n");
}

function buildVaultText() {
  return [
    "Local Secret Vault:",
    "http://127.0.0.1:8789/secrets",
    "Stores configured secrets locally and returns redacted metadata only."
  ].join("\n");
}

function buildProjectsText() {
  return [
    "Default project: links",
    "Repo: andylitvinov-design/codex-links",
    "Target: Cloudflare Pages codex-links"
  ].join("\n");
}

function buildVersionText({ env = process.env } = {}) {
  return [
    `gatewayVersion=${GATEWAY_VERSION}`,
    "status=running",
    `baseUrl=${getBaseUrl(env)}`,
    `writeTokenConfigured=${Boolean(getWriteToken(env))}`
  ].join("\n");
}

function buildCommandPayload({ taskText, chatId, messageId, username, dispatchMode }) {
  const payload = {
    text: taskText,
    clientId: `telegram:${chatId}`,
    threadId: "links",
    threadLabel: `Telegram ${chatId}`,
    projectId: "links",
    projectLabel: "links",
    source: "telegram-openclaw",
    telegram: {
      chatId: String(chatId),
      messageId: String(messageId || ""),
      username: String(username || "")
    }
  };
  if (dispatchMode) payload.dispatchMode = dispatchMode;
  return payload;
}

async function createCodexCommand({ taskText, chatId, messageId, username, env = process.env, fetchImpl = fetch }) {
  const writeToken = getWriteToken(env);
  if (!writeToken) {
    return { ok: false, status: "needs_config", reason: "missing_write_token" };
  }

  const payload = buildCommandPayload({
    taskText,
    chatId,
    messageId,
    username,
    dispatchMode: String(env.OPENCLAW_TELEGRAM_DISPATCH_MODE || "").trim()
  });
  const { response, data, text } = await requestJson(`${getBaseUrl(env)}/api/commands`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-write-token": writeToken
    },
    body: JSON.stringify(payload)
  }, fetchImpl);

  if (!response.ok || data?.ok === false) {
    return {
      ok: false,
      status: "command_create_failed",
      httpStatus: response.status,
      reason: redact(data?.error || text.slice(0, 200) || "Codex Links API returned an error.")
    };
  }

  return {
    ok: true,
    status: "created",
    commandId: data?.command?.id || ""
  };
}

async function handleTelegramUpdate(update, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const token = options.token || env.TELEGRAM_BOT_TOKEN || "";
  const allowedChatIds = options.allowedChatIds || parseAllowedChatIds(env.OPENCLAW_TELEGRAM_ALLOWED_CHAT_IDS);
  const message = update?.message || update?.edited_message || null;
  const chatId = message?.chat?.id;
  const messageId = message?.message_id;
  const username = message?.from?.username || message?.chat?.username || "";
  const text = String(message?.text || "").trim();

  if (!message || !chatId) {
    return { ok: true, status: "ignored", reason: "no_message" };
  }

  if (isCommand(text, "start")) {
    await sendTelegramMessage({ token, chatId, text: buildWelcomeText(), fetchImpl });
    return { ok: true, status: "start_replied" };
  }

  if (isCommand(text, "help")) {
    await sendTelegramMessage({ token, chatId, text: buildHelpText(), fetchImpl });
    return { ok: true, status: "help_replied" };
  }

  if (!isAllowedChat(chatId, allowedChatIds)) {
    log("update_skipped", { reason: "unauthorized_chat", chatId: String(chatId), messageId });
    return { ok: true, status: "skipped", reason: "unauthorized_chat" };
  }

  if (isCommand(text, "status")) {
    await sendTelegramMessage({ token, chatId, text: buildStatusText({ env }), fetchImpl });
    return { ok: true, status: "status_replied" };
  }

  if (isCommand(text, "vault")) {
    await sendTelegramMessage({ token, chatId, text: buildVaultText(), fetchImpl });
    return { ok: true, status: "vault_replied" };
  }

  if (isCommand(text, "projects")) {
    await sendTelegramMessage({ token, chatId, text: buildProjectsText(), fetchImpl });
    return { ok: true, status: "projects_replied" };
  }

  if (isCommand(text, "version")) {
    await sendTelegramMessage({ token, chatId, text: buildVersionText({ env }), fetchImpl });
    return { ok: true, status: "version_replied" };
  }

  const taskText = normalizeCommandText(text);
  if (!taskText) {
    return { ok: true, status: "rejected", reason: "missing_command_prefix" };
  }

  const created = await createCodexCommand({ taskText, chatId, messageId, username, env, fetchImpl });
  if (!created.ok && created.status === "needs_config") {
    await sendTelegramMessage({ token, chatId, text: "needs_config", fetchImpl });
    return created;
  }
  if (!created.ok) {
    await sendTelegramMessage({ token, chatId, text: "failed", fetchImpl });
    return created;
  }

  await sendTelegramMessage({ token, chatId, text: `queued ${created.commandId}`.trim(), fetchImpl });
  log("command_created", { chatId: String(chatId), messageId, commandId: created.commandId || "" });
  return created;
}

async function pollTelegramOnce(options = {}) {
  const token = options.token || process.env.TELEGRAM_BOT_TOKEN || "";
  const fetchImpl = options.fetchImpl || fetch;
  const statePath = options.statePath || STATE_PATH;
  const state = await readState(statePath);
  const url = new URL(`${getTelegramApiBase(token)}/getUpdates`);
  if (state.offset) url.searchParams.set("offset", String(state.offset));
  url.searchParams.set("timeout", String(options.timeoutSeconds ?? DEFAULT_POLL_TIMEOUT_SECONDS));
  url.searchParams.set("allowed_updates", JSON.stringify(["message", "edited_message"]));

  const { response, data, text } = await requestJson(url.toString(), { method: "GET" }, fetchImpl);
  if (!response.ok || !data?.ok) {
    return {
      ok: false,
      status: "telegram_poll_failed",
      httpStatus: response.status,
      reason: redact(data?.description || text.slice(0, 160) || "")
    };
  }

  const updates = Array.isArray(data.result) ? data.result : [];
  let nextOffset = state.offset;
  for (const update of updates) {
    const updateId = Number(update?.update_id);
    if (Number.isFinite(updateId)) nextOffset = Math.max(nextOffset, updateId + 1);
    await handleTelegramUpdate(update, options);
  }
  if (nextOffset !== state.offset) await writeState({ offset: nextOffset }, statePath);
  return { ok: true, status: "polled", count: updates.length, offset: nextOffset };
}

async function runPollingLoop(options = {}) {
  const pollIntervalMs = Number(process.env.OPENCLAW_TELEGRAM_POLL_INTERVAL_MS || DEFAULT_POLL_INTERVAL_MS);
  while (!options.abortSignal?.aborted) {
    try {
      const result = await pollTelegramOnce(options);
      if (!result.ok) log("poll_degraded", { status: result.status, httpStatus: result.httpStatus || 0, reason: result.reason || "" });
    } catch (error) {
      log("poll_error", { error: redact(error?.message || String(error)) });
    }
    await sleep(Number.isFinite(pollIntervalMs) && pollIntervalMs >= 250 ? pollIntervalMs : DEFAULT_POLL_INTERVAL_MS);
  }
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  const verification = await verifyTelegramToken(token);
  if (!verification.ok && verification.status === "missing_token") {
    log("startup_failed", verification);
    process.exitCode = 2;
    return;
  }

  if (!verification.ok) {
    log("startup_degraded", verification);
  } else {
    log("startup_ok", verification);
  }

  const commandSetup = await setTelegramBotCommands({ token });
  log("bot_commands", {
    status: commandSetup.status,
    ok: commandSetup.ok,
    httpStatus: commandSetup.httpStatus || 0,
    description: commandSetup.description || commandSetup.reason || ""
  });

  const allowedChatIds = parseAllowedChatIds(process.env.OPENCLAW_TELEGRAM_ALLOWED_CHAT_IDS);
  log("config", {
    allowedChatCount: allowedChatIds.size,
    codexLinksBaseUrl: getBaseUrl(),
    writeTokenConfigured: Boolean(getWriteToken())
  });

  const controller = new AbortController();
  const heartbeatMs = Number(process.env.OPENCLAW_TELEGRAM_HEARTBEAT_MS || DEFAULT_HEARTBEAT_MS);
  const heartbeat = setInterval(() => {
    log("heartbeat", { status: "running" });
  }, Number.isFinite(heartbeatMs) && heartbeatMs >= 10_000 ? heartbeatMs : DEFAULT_HEARTBEAT_MS);

  const shutdown = (signal) => {
    controller.abort();
    clearInterval(heartbeat);
    log("shutdown", { signal });
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  await runPollingLoop({ token, allowedChatIds, abortSignal: controller.signal });
}

export {
  GATEWAY_VERSION,
  STATE_PATH,
  TELEGRAM_BOT_COMMANDS,
  buildHelpText,
  buildCommandPayload,
  buildProjectsText,
  buildStatusText,
  buildVaultText,
  buildVersionText,
  buildWelcomeText,
  createCodexCommand,
  getBaseUrl,
  getTelegramCommand,
  getWriteToken,
  handleTelegramUpdate,
  isAllowedChat,
  isCommand,
  normalizeCommandText,
  parseAllowedChatIds,
  pollTelegramOnce,
  redact,
  sendTelegramMessage,
  setTelegramBotCommands,
  verifyTelegramToken
};

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  await main();
}
