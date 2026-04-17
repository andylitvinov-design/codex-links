import { withCodexAppServer } from "./codex-app-rpc.mjs";
import path from "node:path";
import fs from "node:fs";

const baseUrl = process.env.LINKS_BASE_URL || "https://codex-links.pages.dev";
const token = process.env.LINKS_WRITE_TOKEN;
const MAX_THREADS_PER_CATEGORY = 7;
const MIN_THREAD_MESSAGES = 4;

if (!token) {
  console.error("Set LINKS_WRITE_TOKEN before running thread sync.");
  process.exit(1);
}

function getCategoryFromCwd(rawCwd) {
  const cwd = String(rawCwd || "").trim();

  if (!cwd) {
    return "";
  }

  const parts = cwd.split("/").filter(Boolean);
  const projectsIndex = parts.findIndex((part) => part === "projects");

  if (projectsIndex >= 0 && parts[projectsIndex + 2]) {
    return parts[projectsIndex + 2];
  }

  return path.basename(cwd);
}

function shouldIncludeThread(rawTitle) {
  const firstLine = String(rawTitle || "").trim();

  if (!firstLine) {
    return false;
  }

  if (/^automation:/i.test(firstLine)) {
    return false;
  }

  if (/^system (role|goal|restructure task)/i.test(firstLine)) {
    return false;
  }

  if (/^task:/i.test(firstLine)) {
    return false;
  }

  if (/^autonomous task:/i.test(firstLine)) {
    return false;
  }

  if (/^##\s/.test(firstLine)) {
    return false;
  }

  if (/^continue$/i.test(firstLine)) {
    return false;
  }

  if (/^(https?:\/\/|file:\/\/)/i.test(firstLine)) {
    return false;
  }

  if (/^automation\b/i.test(firstLine)) {
    return false;
  }

  return true;
}

function getThreadMessageCountFromSession(sessionPath) {
  const filePath = String(sessionPath || "").trim();

  if (!filePath) {
    return 0;
  }

  try {
    const lines = fs.readFileSync(filePath, "utf8").split("\n");
    let count = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed) {
        continue;
      }

      let entry;

      try {
        entry = JSON.parse(trimmed);
      } catch {
        continue;
      }

      if (entry?.type !== "response_item") {
        continue;
      }

      const payload = entry?.payload || {};

      if (payload?.type !== "message") {
        continue;
      }

      if (payload?.role === "user" || payload?.role === "assistant") {
        count += 1;
      }
    }

    return count;
  } catch {
    return 0;
  }
}

function normalizeThreadTimestamp(rawValue) {
  const value = Number(rawValue);

  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.floor(value);
}

const threads = await withCodexAppServer(async ({ request }) => {
  const items = [];
  const seen = new Set();
  let cursor = null;

  while (true) {
    const result = await request("thread/list", {
      limit: 100,
      archived: false,
      sourceKinds: ["vscode", "cli"],
      cursor
    });

    for (const row of result?.data || []) {
      const id = String(row?.id || "").trim();
      const rawLabel = String(row?.name || row?.preview || "").trim();
      const category = getCategoryFromCwd(row?.cwd);
      const messageCount = getThreadMessageCountFromSession(row?.path);
      const createdAt = normalizeThreadTimestamp(row?.createdAt);
      const updatedAt = normalizeThreadTimestamp(row?.updatedAt);

      if (!shouldIncludeThread(rawLabel) || !id || messageCount < MIN_THREAD_MESSAGES) {
        continue;
      }

      const label = rawLabel.replace(/\s+/g, " ").trim().slice(0, 72);
      const displayLabel = category ? `${category} / ${label}` : label;

      if (!label || seen.has(id)) {
        continue;
      }

      seen.add(id);
      items.push({ id, label, category, displayLabel, messageCount, createdAt, updatedAt });
    }

    if (!result?.nextCursor) {
      break;
    }

    cursor = result.nextCursor;
  }

  return [...items.reduce((groups, item) => {
    const key = item.category || "other";
    const bucket = groups.get(key) || [];
    bucket.push(item);
    groups.set(key, bucket);
    return groups;
  }, new Map()).values()]
    .flatMap((bucket) =>
      bucket
        .sort((left, right) =>
          (right.updatedAt || right.createdAt || 0) - (left.updatedAt || left.createdAt || 0)
          || right.messageCount - left.messageCount
          || left.label.localeCompare(right.label, "ru")
        )
        .slice(0, MAX_THREADS_PER_CATEGORY)
    );
});

const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/threads`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-write-token": token
  },
  body: JSON.stringify({ threads })
});

const body = await response.text();
console.log(response.status, body);

if (!response.ok) {
  process.exit(1);
}
