import { HISTORY_RETENTION_MS, INBOX_MESSAGES_STORAGE_KEY, MAX_INBOX_MESSAGES } from "./constants.js";

function normalizeId(rawId) {
  return String(rawId || "").trim().slice(0, 200);
}

function normalizeClientId(rawClientId) {
  return String(rawClientId || "").trim().slice(0, 120);
}

function normalizeThreadId(rawThreadId) {
  return String(rawThreadId || "").trim().slice(0, 160);
}

function normalizeThreadLabel(rawThreadLabel) {
  return String(rawThreadLabel || "").trim().slice(0, 160);
}

function normalizeCommandId(rawCommandId) {
  return String(rawCommandId || "").trim().slice(0, 120);
}

function normalizeText(rawText) {
  return String(rawText || "").trim().slice(0, 12000);
}

function normalizeRole(rawRole) {
  return rawRole === "assistant" ? "assistant" : "user";
}

function isWithinRetentionWindow(value) {
  const timestamp = Date.parse(String(value || "").trim());

  if (Number.isNaN(timestamp)) {
    return false;
  }

  return timestamp >= Date.now() - HISTORY_RETENTION_MS;
}

function normalizeMessage(input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const id = normalizeId(input.id);
  const clientId = normalizeClientId(input.clientId);
  const threadId = normalizeThreadId(input.threadId);
  const threadLabel = normalizeThreadLabel(input.threadLabel);
  const commandId = normalizeCommandId(input.commandId);
  const text = normalizeText(input.text);
  const role = normalizeRole(input.role);
  const createdAt = String(input.createdAt || "").trim();

  if (!id || !clientId || !threadId || !text || !createdAt) {
    return null;
  }

  return {
    id,
    clientId,
    threadId,
    threadLabel,
    commandId,
    role,
    text,
    createdAt
  };
}

export async function readMessages(env) {
  const existing = await env.LINKS_STORE.get(INBOX_MESSAGES_STORAGE_KEY, "json");

  if (!Array.isArray(existing)) {
    return [];
  }

  return existing
    .map((message) => normalizeMessage(message))
    .filter(Boolean)
    .filter((message) => isWithinRetentionWindow(message.createdAt))
    .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
}

export async function writeMessages(env, messages) {
  const trimmed = messages
    .map((message) => normalizeMessage(message))
    .filter(Boolean)
    .filter((message) => isWithinRetentionWindow(message.createdAt))
    .slice(-MAX_INBOX_MESSAGES);
  await env.LINKS_STORE.put(INBOX_MESSAGES_STORAGE_KEY, JSON.stringify(trimmed));
  return trimmed;
}

export async function upsertMessages(env, messages) {
  const current = await readMessages(env);
  const next = new Map(current.map((message) => [message.id, message]));

  for (const message of Array.isArray(messages) ? messages : []) {
    const normalized = normalizeMessage(message);

    if (!normalized) {
      continue;
    }

    next.set(normalized.id, normalized);
  }

  const ordered = [...next.values()].sort((left, right) =>
    String(left.createdAt || "").localeCompare(String(right.createdAt || ""))
  );

  await writeMessages(env, ordered);
  return ordered;
}

export async function replaceMessages(env, messages) {
  const ordered = (Array.isArray(messages) ? messages : [])
    .map((message) => normalizeMessage(message))
    .filter(Boolean)
    .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));

  await writeMessages(env, ordered);
  return ordered;
}

export async function getMessagesForClient(env, clientId) {
  const normalizedClientId = normalizeClientId(clientId);

  if (!normalizedClientId) {
    return [];
  }

  const messages = await readMessages(env);
  return messages.filter((message) => message.clientId === normalizedClientId);
}
