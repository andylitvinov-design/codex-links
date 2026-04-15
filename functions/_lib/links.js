import { MAX_LINKS, STORAGE_KEY } from "./constants.js";

function ensureUrl(input) {
  try {
    const parsed = new URL(input);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeTitle(rawTitle, url) {
  const title = String(rawTitle || "").trim();

  if (title) {
    return title.slice(0, 160);
  }

  return url;
}

function normalizeNote(rawNote) {
  return String(rawNote || "").trim().slice(0, 600);
}

function normalizeThreadLabel(rawThreadLabel) {
  return String(rawThreadLabel || "").trim().slice(0, 120);
}

export function normalizeThreads(rawThreads, rawThreadLabel) {
  const source = Array.isArray(rawThreads)
    ? rawThreads
    : rawThreads
      ? [rawThreads]
      : rawThreadLabel
        ? [rawThreadLabel]
        : [];

  return [...new Set(
    source
      .map((thread) => normalizeThreadLabel(thread))
      .filter(Boolean)
      .slice(0, 8)
  )];
}

export function normalizeTags(rawTags) {
  const source = Array.isArray(rawTags)
    ? rawTags
    : String(rawTags || "")
        .split(",");

  return [...new Set(
    source
      .map((tag) => String(tag || "").trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 8)
  )];
}

export function normalizeSource(rawSource) {
  const source = String(rawSource || "").trim().toLowerCase();
  return source === "codex" ? "codex" : "manual";
}

export function createLinkRecord(input) {
  const url = ensureUrl(input.url);

  if (!url) {
    return {
      ok: false,
      error: "Invalid URL. Only http/https links are allowed."
    };
  }

  return {
    ok: true,
    value: {
      id: crypto.randomUUID(),
      url,
      title: normalizeTitle(input.title, url),
      note: normalizeNote(input.note),
      threads: normalizeThreads(input.threads, input.threadLabel),
      tags: normalizeTags(input.tags),
      createdAt: new Date().toISOString(),
      source: normalizeSource(input.source)
    }
  };
}

export async function readLinks(env) {
  const existing = await env.LINKS_STORE.get(STORAGE_KEY, "json");

  if (!Array.isArray(existing)) {
    return [];
  }

  return existing
    .filter((entry) => entry && typeof entry === "object" && typeof entry.url === "string")
    .map((entry) => ({
      ...entry,
      threads: normalizeThreads(entry.threads, entry.threadLabel)
    }))
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
}

export async function writeLinks(env, links) {
  const trimmed = links.slice(0, MAX_LINKS);
  await env.LINKS_STORE.put(STORAGE_KEY, JSON.stringify(trimmed));
  return trimmed;
}

export async function insertLink(env, input) {
  const normalized = createLinkRecord(input);

  if (!normalized.ok) {
    return normalized;
  }

  const current = await readLinks(env);
  const next = [normalized.value, ...current];
  await writeLinks(env, next);

  return normalized;
}
