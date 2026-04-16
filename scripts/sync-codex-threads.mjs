import { withCodexAppServer } from "./codex-app-rpc.mjs";
import path from "node:path";
import fs from "node:fs";

const baseUrl = process.env.LINKS_BASE_URL || "https://codex-links.pages.dev";
const token = process.env.LINKS_WRITE_TOKEN;

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

      if (!shouldIncludeThread(rawLabel) || !id) {
        continue;
      }

      const label = rawLabel.replace(/\s+/g, " ").trim().slice(0, 72);
      const displayLabel = category ? `${category} / ${label}` : label;

      if (!label || seen.has(id)) {
        continue;
      }

      seen.add(id);
      items.push({ id, label, category, displayLabel, messageCount });
    }

    if (!result?.nextCursor) {
      break;
    }

    cursor = result.nextCursor;
  }

  return items;
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
