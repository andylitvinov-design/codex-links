import { HISTORY_RETENTION_MS, MAX_THREADS, THREADS_STORAGE_KEY } from "./constants.js";

function normalizeThreadId(rawThreadId) {
  return String(rawThreadId || "").trim().slice(0, 160);
}

function normalizeThreadCategory(rawThreadCategory) {
  return String(rawThreadCategory || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function normalizeThreadLabel(rawThreadLabel, threadId) {
  const label = String(rawThreadLabel || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);

  return label || threadId || "Untitled";
}

function normalizeDisplayLabel(rawDisplayLabel, label, category) {
  const displayLabel = String(rawDisplayLabel || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);

  if (displayLabel) {
    return displayLabel;
  }

  return category ? `${category} / ${label}` : label;
}

function isWithinRetentionWindow(value) {
  if (!String(value || "").trim()) {
    return true;
  }

  const timestamp = Date.parse(String(value || "").trim());

  if (Number.isNaN(timestamp)) {
    return false;
  }

  return timestamp >= Date.now() - HISTORY_RETENTION_MS;
}

function normalizeThread(input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const id = normalizeThreadId(input.id);
  const category = normalizeThreadCategory(input.category);
  const label = normalizeThreadLabel(input.label, id);
  const displayLabel = normalizeDisplayLabel(input.displayLabel, label, category);
  const syncedAt = String(input.syncedAt || "").trim();

  if (!id) {
    return null;
  }

  return { id, label, category, displayLabel, syncedAt };
}

export async function readThreads(env) {
  const existing = await env.LINKS_STORE.get(THREADS_STORAGE_KEY, "json");

  if (!Array.isArray(existing)) {
    return [];
  }

  return existing
    .map((thread) => normalizeThread(thread))
    .filter(Boolean)
    .filter((thread) => isWithinRetentionWindow(thread.syncedAt))
    .sort((left, right) =>
      (left.displayLabel || left.label).localeCompare((right.displayLabel || right.label), "ru")
    );
}

export async function writeThreads(env, threads) {
  const syncedAt = new Date().toISOString();
  const normalized = [...new Map(
    (Array.isArray(threads) ? threads : [])
      .map((thread) => normalizeThread(thread))
      .filter(Boolean)
      .map((thread) => [thread.id, { ...thread, syncedAt }])
  ).values()]
    .filter((thread) => isWithinRetentionWindow(thread.syncedAt))
    .slice(0, MAX_THREADS)
    .sort((left, right) =>
      (left.displayLabel || left.label).localeCompare((right.displayLabel || right.label), "ru")
    );

  await env.LINKS_STORE.put(THREADS_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}
