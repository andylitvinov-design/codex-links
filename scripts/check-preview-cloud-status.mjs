#!/usr/bin/env node

const PROJECT_HOST = process.env.CODEX_LINKS_PREVIEW_HOST || "codex-links.pages.dev";
const EXPLICIT_URL = String(process.env.CODEX_LINKS_PREVIEW_URL || "").trim();
const BRANCH_NAME = String(
  process.env.GITHUB_HEAD_REF
  || process.env.CODEX_LINKS_PREVIEW_BRANCH
  || process.env.BRANCH_NAME
  || ""
).trim();
const RETRY_LIMIT = Number(process.env.CODEX_LINKS_PREVIEW_RETRY_LIMIT || 30);
const RETRY_DELAY_MS = Number(process.env.CODEX_LINKS_PREVIEW_RETRY_DELAY_MS || 10_000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugifyBranchName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function getPreviewUrl() {
  if (EXPLICIT_URL) {
    return EXPLICIT_URL.replace(/\/+$/, "");
  }

  const slug = slugifyBranchName(BRANCH_NAME);

  if (!slug) {
    throw new Error("Set CODEX_LINKS_PREVIEW_URL or provide GITHUB_HEAD_REF to resolve the Pages preview URL.");
  }

  return `https://${slug}.${PROJECT_HOST}`;
}

async function loadPreviewStatus(baseUrl) {
  const response = await fetch(`${baseUrl}/api/status?_=${Date.now()}`, {
    headers: { accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = await response.json().catch(() => ({}));
  return payload?.status || {};
}

async function main() {
  const previewUrl = getPreviewUrl();
  console.log(`Checking preview trusted-cloud status at ${previewUrl}/api/status`);

  let lastError = "";

  for (let attempt = 1; attempt <= RETRY_LIMIT; attempt += 1) {
    try {
      const status = await loadPreviewStatus(previewUrl);
      const dispatchMode = String(status.dispatchMode || "").trim();
      const executorLabel = String(status.executorLabel || "").trim();
      const statusError = String(status.lastError || "").trim();

      console.log(`attempt=${attempt} dispatchMode=${dispatchMode || "empty"} executorLabel=${executorLabel || "empty"} lastError=${statusError || "none"}`);

      if (dispatchMode === "cloud" && !statusError) {
        console.log("Preview trusted-cloud status is valid.");
        return;
      }

      lastError = `dispatchMode=${dispatchMode || "empty"} lastError=${statusError || "none"}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.log(`attempt=${attempt} preview status not ready: ${lastError}`);
    }

    if (attempt < RETRY_LIMIT) {
      await sleep(RETRY_DELAY_MS);
    }
  }

  throw new Error(`Preview deployment did not become a valid trusted-cloud target: ${lastError || "unknown error"}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
