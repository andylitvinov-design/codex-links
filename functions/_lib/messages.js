import {
  HISTORY_RETENTION_MS,
  INBOX_MESSAGE_ITEM_PREFIX,
  INBOX_MESSAGES_CLIENT_INDEX_PREFIX,
  INBOX_MESSAGES_RECENT_STORAGE_KEY,
  INBOX_MESSAGES_STORAGE_KEY,
  MAX_INBOX_MESSAGES
} from "./constants.js";

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

function messageItemKey(id) {
  return `${INBOX_MESSAGE_ITEM_PREFIX}${normalizeId(id)}`;
}

function clientMessageIndexKey(clientId) {
  return `${INBOX_MESSAGES_CLIENT_INDEX_PREFIX}${normalizeClientId(clientId)}`;
}

function uniqIds(ids, max = MAX_INBOX_MESSAGES) {
  return [...new Set(
    (Array.isArray(ids) ? ids : [])
      .map((id) => normalizeId(id))
      .filter(Boolean)
  )].slice(-max);
}

async function readIdIndex(env, key) {
  const existing = await env.LINKS_STORE.get(key, "json");
  return uniqIds(existing);
}

async function writeIdIndex(env, key, ids) {
  await env.LINKS_STORE.put(key, JSON.stringify(uniqIds(ids)));
}

async function appendIndexedMessageId(env, key, id) {
  const normalizedId = normalizeId(id);

  if (!normalizedId) {
    return;
  }

  const current = await readIdIndex(env, key).catch(() => []);
  await writeIdIndex(env, key, [...current, normalizedId]);
}

async function readStoredMessage(env, id) {
  const normalizedId = normalizeId(id);
  return normalizedId ? (await env.LINKS_STORE.get(messageItemKey(normalizedId), "json")) : null;
}

async function readStoredMessagesByIds(env, ids) {
  const entries = await Promise.all(uniqIds(ids).map((id) => readStoredMessage(env, id)));
  return entries.map((entry) => normalizeMessage(entry)).filter(Boolean);
}

async function rebuildMessageIndexes(env, messages) {
  const normalized = (Array.isArray(messages) ? messages : [])
    .map((message) => normalizeMessage(message))
    .filter(Boolean)
    .filter((message) => isWithinRetentionWindow(message.createdAt))
    .slice(-MAX_INBOX_MESSAGES);
  const recentIds = [];
  const clientBuckets = new Map();

  for (const message of normalized) {
    await env.LINKS_STORE.put(messageItemKey(message.id), JSON.stringify(message));
    recentIds.push(message.id);
    const bucket = clientBuckets.get(message.clientId) || [];
    bucket.push(message.id);
    clientBuckets.set(message.clientId, bucket);
  }

  await Promise.all([
    writeIdIndex(env, INBOX_MESSAGES_RECENT_STORAGE_KEY, recentIds),
    ...[...clientBuckets.entries()].map(([clientId, ids]) => writeIdIndex(env, clientMessageIndexKey(clientId), ids))
  ]);
}

async function persistMessage(env, message) {
  const normalized = normalizeMessage(message);

  if (!normalized || !isWithinRetentionWindow(normalized.createdAt)) {
    return null;
  }

  await env.LINKS_STORE.put(messageItemKey(normalized.id), JSON.stringify(normalized));
  await Promise.all([
    appendIndexedMessageId(env, INBOX_MESSAGES_RECENT_STORAGE_KEY, normalized.id),
    appendIndexedMessageId(env, clientMessageIndexKey(normalized.clientId), normalized.id)
  ]);

  return normalized;
}

export async function readMessages(env) {
  const indexedIds = await readIdIndex(env, INBOX_MESSAGES_RECENT_STORAGE_KEY).catch(() => []);
  let existing = [];

  if (indexedIds.length) {
    existing = await readStoredMessagesByIds(env, indexedIds);
  } else {
    const legacy = await env.LINKS_STORE.get(INBOX_MESSAGES_STORAGE_KEY, "json");
    existing = Array.isArray(legacy) ? legacy : [];
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
  await rebuildMessageIndexes(env, trimmed);
  return trimmed;
}

export async function upsertMessages(env, messages) {
  const persisted = await Promise.all(
    (Array.isArray(messages) ? messages : []).map((message) => persistMessage(env, message))
  );

  return persisted.filter(Boolean).sort((left, right) =>
    String(left.createdAt || "").localeCompare(String(right.createdAt || ""))
  );
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

  const indexedIds = await readIdIndex(env, clientMessageIndexKey(normalizedClientId)).catch(() => []);

  if (indexedIds.length) {
    return (await readStoredMessagesByIds(env, indexedIds))
      .filter((message) => message.clientId === normalizedClientId)
      .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
  }

  const messages = await readMessages(env);
  return messages.filter((message) => message.clientId === normalizedClientId);
}
