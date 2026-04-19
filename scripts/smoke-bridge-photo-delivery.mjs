#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const BASE_URL = process.env.CODEX_LINKS_URL || "https://codex-links.pages.dev";
const TARGET_PROJECT_ID = process.env.CODEX_LINKS_SMOKE_PROJECT_ID || "links";
const TARGET_PROJECT_LABEL = process.env.CODEX_LINKS_SMOKE_PROJECT_LABEL || "links";
const TARGET_REPO = process.env.CODEX_LINKS_SMOKE_REPO || "andylitvinov-design/codex-links";
const TARGET_REPO_URL = process.env.CODEX_LINKS_SMOKE_REPO_URL || "https://github.com/andylitvinov-design/codex-links";
const TARGET_CONTEXT_FILES = ["AGENTS.md", "README.md", "STATE.md"];
const clientId = `bridge-photo-smoke-${Date.now()}`;
const text = "photo bridge probe ignore: reply with PHOTO_OK only after reading the attached image";
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

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function assertManifestContext(command, label) {
  if (!command || typeof command !== "object") {
    throw new Error(`${label}: command payload is missing.`);
  }

  const projectId = String(command.projectId || command.threadId || "").trim();
  const targetRepo = String(command.targetRepo || "").trim();
  const targetRepoUrl = String(command.targetRepoUrl || "").trim();
  const targetContextFiles = normalizeStringArray(command.targetContextFiles);

  if (projectId !== TARGET_PROJECT_ID) {
    throw new Error(`${label}: expected projectId=${TARGET_PROJECT_ID}, got ${projectId || "empty"}.`);
  }

  if (targetRepo !== TARGET_REPO) {
    throw new Error(`${label}: expected targetRepo=${TARGET_REPO}, got ${targetRepo || "empty"}.`);
  }

  if (targetRepoUrl !== TARGET_REPO_URL) {
    throw new Error(`${label}: expected targetRepoUrl=${TARGET_REPO_URL}, got ${targetRepoUrl || "empty"}.`);
  }

  if (targetContextFiles.join("::") !== TARGET_CONTEXT_FILES.join("::")) {
    throw new Error(`${label}: expected targetContextFiles=${TARGET_CONTEXT_FILES.join(", ")}, got ${targetContextFiles.join(", ") || "empty"}.`);
  }
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
      dispatchMode: "local-bridge",
      targetExecutionMode: "bridge",
      targetRepo: TARGET_REPO,
      targetRepoUrl: TARGET_REPO_URL,
      targetContextFiles: TARGET_CONTEXT_FILES,
      text,
      photo: {
        contentType: "image/png",
        fileName: "bridge-photo-smoke.png",
        size: photo.size,
        dataUrl: photo.dataUrl
      }
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.command?.id) {
    throw new Error(String(data?.error || "").trim() || `POST /api/commands failed with ${response.status}`);
  }

  assertManifestContext(data.command, "bridge photo create");
  return data.command;
}

async function pollCommand(id) {
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < 300000) {
    const response = await fetch(`${BASE_URL}/api/commands?id=${encodeURIComponent(id)}`, {
      headers: { accept: "application/json" }
    });
    const data = await response.json().catch(() => ({}));
    const command = data?.command || null;

    if (command) {
      assertManifestContext(command, "bridge photo poll");
      const status = String(command.status || "").trim().toLowerCase();
      console.log(`status=${status || "unknown"} stage=${String(command.progressStage || "").trim() || "unknown"} dispatchMode=${String(command.dispatchMode || "").trim() || "unknown"}`);

      if (status === "answered") {
        const replies = await fetchAssistantReplies(command.id);
        const matched = replies.find((reply) => /PHOTO_OK/i.test(String(reply?.text || "")));

        if (!matched) {
          throw new Error("Bridge photo smoke answered, but PHOTO_OK reply was not found.");
        }

        return command;
      }

      if (status === "failed") {
        throw new Error(String(command.errorMessage || "Bridge photo smoke failed."));
      }
    }

    await sleep(5000);
  }

  throw new Error("Bridge photo smoke timed out waiting for a reply.");
}

async function main() {
  console.log(`Submitting bridge photo smoke command to ${BASE_URL}`);
  const command = await postCommand();
  console.log(`commandId=${command.id}`);
  const answered = await pollCommand(command.id);
  console.log(`Bridge photo smoke OK: command ${answered.id} answered via stage=${answered.progressStage || "unknown"} dispatchMode=${answered.dispatchMode || "unknown"}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
