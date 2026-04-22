#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const LAUNCH_AGENT_PATH = `${process.env.HOME || ""}/Library/LaunchAgents/com.andriilitvinov.codex-links-bridge.plist`;

function extractPlistValue(plist, key) {
  const pattern = new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`, "i");
  const match = String(plist || "").match(pattern);
  return String(match?.[1] || "").trim();
}

async function resolveRuntimeConfig() {
  const envBaseUrl = String(process.env.CODEX_LINKS_URL || "").trim();
  const envWriteToken = String(process.env.LINKS_WRITE_TOKEN || "").trim();

  if (envBaseUrl && envWriteToken) {
    return {
      baseUrl: envBaseUrl,
      writeToken: envWriteToken
    };
  }

  try {
    const plist = await readFile(LAUNCH_AGENT_PATH, "utf8");
    return {
      baseUrl: envBaseUrl || extractPlistValue(plist, "LINKS_BASE_URL") || "https://codex-links.pages.dev",
      writeToken: envWriteToken || extractPlistValue(plist, "LINKS_WRITE_TOKEN")
    };
  } catch {
    return {
      baseUrl: envBaseUrl || "https://codex-links.pages.dev",
      writeToken: envWriteToken
    };
  }
}

async function main() {
  const { baseUrl, writeToken } = await resolveRuntimeConfig();

  if (!writeToken) {
    throw new Error("Set LINKS_WRITE_TOKEN before running delivery maintenance.");
  }

  const response = await fetch(new URL("/api/admin/commands-maintenance", baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-write-token": writeToken
    },
    body: JSON.stringify({
      syncReplies: true
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(String(data?.error || "").trim() || `Maintenance failed with HTTP ${response.status}.`);
  }

  console.log(JSON.stringify({
    ok: true,
    changed: Boolean(data?.summary?.changed),
    changedCount: Number(data?.summary?.changedCount || 0),
    dispatchedCount: Number(data?.summary?.dispatchedCount || 0),
    syncReplies: data?.summary?.syncReplies !== false
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
