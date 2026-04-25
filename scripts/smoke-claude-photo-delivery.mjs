#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const BASE_URL = process.env.CODEX_LINKS_URL || "https://codex-links.pages.dev";
const TARGET_PROJECT_ID = process.env.CODEX_LINKS_SMOKE_PROJECT_ID || "links";
const TARGET_PROJECT_LABEL = process.env.CODEX_LINKS_SMOKE_PROJECT_LABEL || "links";
const TARGET_REPO = process.env.CODEX_LINKS_SMOKE_REPO || "andylitvinov-design/codex-links";
const TARGET_REPO_URL = process.env.CODEX_LINKS_SMOKE_REPO_URL || "https://github.com/andylitvinov-design/codex-links";
const TARGET_CONTEXT_FILES = ["AGENTS.md", "README.md", "STATE.md"];
const clientId = `claude-photo-smoke-${Date.now()}`;
const text = "claude photo probe ignore: reply with CLAUDE_PHOTO_OK only after reading the attached image";
const SMOKE_IMAGE_URL = new URL("../public/icon-192.png", import.meta.url);

async function loadPhotoPayload() {
  const bytes = await readFile(fileURLToPath(SMOKE_IMAGE_URL));
  return {
    dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
    size: bytes.length
  };
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAssistantReplies(commandId) {
  const response = await fetch(`${BASE_URL}/api/messages?scope=public`, {
    headers: { accept: "application/json" }
  });
  const data = await response.json().catch(() => ({}));

  return Array.isArray(data?.messages)
    ? data.messages.filter((message) =>
        String(message?.commandId || "").trim() === String(commandId || "").trim()
        && String(message?.role || "").trim() === "assistant"
      )
    : [];
}

async function fetchCommand(id) {
  const response = await fetch(`${BASE_URL}/api/commands?id=${encodeURIComponent(id)}`, {
    headers: { accept: "application/json" }
  });
  const data = await response.json().catch(() => ({}));
  return data?.command || null;
}

async function ensureClaudeBridgeHealthy() {
  const response = await fetch(`${BASE_URL}/api/status?_=${Date.now()}`, {
    headers: { accept: "application/json" }
  });
  const data = await response.json().catch(() => ({}));
  const claude = data?.bridges?.claudeBridge || data?.status?.claudeBridge || {};

  if (!claude.online) {
    throw new Error(`Claude bridge is not healthy. state=${String(claude.state || "").trim() || "unknown"} lastRunAt=${String(claude.lastRunAt || "").trim() || "empty"} lastError=${String(claude.lastError || "").trim() || "none"}`);
  }
}

async function postCommand() {
  const photo = await loadPhotoPayload();
  const response = await fetch(`${BASE_URL}/api/commands`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({
      clientId,
      threadId: TARGET_PROJECT_ID,
      threadLabel: TARGET_PROJECT_LABEL,
      projectId: TARGET_PROJECT_ID,
      dispatchMode: "claude-bridge",
      targetExecutionMode: "claude",
      targetRepo: TARGET_REPO,
      targetRepoUrl: TARGET_REPO_URL,
      targetContextFiles: TARGET_CONTEXT_FILES,
      text,
      photo: {
        contentType: "image/png",
        fileName: "claude-photo-smoke.png",
        size: photo.size,
        dataUrl: photo.dataUrl
      }
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.command?.id) {
    throw new Error(String(data?.error || "").trim() || `POST /api/commands failed with ${response.status}`);
  }

  return data.command;
}

async function pollCommand(id) {
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < 180000) {
    const command = await fetchCommand(id);

    if (command) {
      const status = String(command.status || "").trim().toLowerCase();
      console.log([
        `status=${status || "unknown"}`,
        `stage=${String(command.progressStage || "").trim() || "unknown"}`,
        `dispatchMode=${String(command.dispatchMode || "").trim() || "unknown"}`,
        `actualExecutor=${String(command.actualExecutor || "").trim() || "unknown"}`
      ].join(" "));

      const replies = await fetchAssistantReplies(command.id);
      const matched = replies.find((reply) => /CLAUDE_PHOTO_OK/i.test(String(reply?.text || "")));

      if (status === "answered") {
        if (!matched) {
          throw new Error("Claude photo smoke answered, but CLAUDE_PHOTO_OK reply was not found.");
        }

        if (command.photoPassedToExecutor !== true) {
          throw new Error("Claude photo smoke answered, but command metadata does not show photoPassedToExecutor=true.");
        }

        return command;
      }

      if (matched) {
        if (command.photoPassedToExecutor !== true) {
          throw new Error("Claude photo smoke found CLAUDE_PHOTO_OK, but command metadata does not show photoPassedToExecutor=true.");
        }
        return command;
      }

      if (status === "failed") {
        throw new Error(String(command.errorMessage || "Claude photo smoke failed."));
      }
    }

    await sleep(5000);
  }

  const command = await fetchCommand(id);
  const replies = await fetchAssistantReplies(id);
  const matched = replies.find((reply) => /CLAUDE_PHOTO_OK/i.test(String(reply?.text || "")));

  if (matched && String(command?.status || "").trim().toLowerCase() !== "failed") {
    if (command?.photoPassedToExecutor !== true) {
      throw new Error("Claude photo smoke found CLAUDE_PHOTO_OK, but command metadata does not show photoPassedToExecutor=true.");
    }
    return command || { id };
  }

  throw new Error("Claude photo smoke timed out waiting for a reply.");
}

async function main() {
  console.log(`Checking Claude bridge health at ${BASE_URL}/api/status`);
  await ensureClaudeBridgeHealthy();
  console.log(`Submitting Claude photo smoke command to ${BASE_URL}`);
  const command = await postCommand();
  console.log(`commandId=${command.id}`);
  const answered = await pollCommand(command.id);
  console.log(`Claude photo smoke OK: command ${answered.id} answered via stage=${answered.progressStage || "unknown"} dispatchMode=${answered.dispatchMode || "unknown"}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
