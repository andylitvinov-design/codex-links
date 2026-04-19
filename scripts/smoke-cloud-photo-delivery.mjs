#!/usr/bin/env node

import fs from "node:fs";

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return Object.fromEntries(
    fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      })
  );
}

const FILE_ENV = parseEnvFile(".dev.vars");
const BASE_URL = process.env.CODEX_LINKS_URL || FILE_ENV.CODEX_LINKS_URL || "https://codex-links.pages.dev";
const TARGET_PROJECT_ID = process.env.CODEX_LINKS_SMOKE_PROJECT_ID || FILE_ENV.CODEX_LINKS_SMOKE_PROJECT_ID || "links";
const TARGET_PROJECT_LABEL = process.env.CODEX_LINKS_SMOKE_PROJECT_LABEL || FILE_ENV.CODEX_LINKS_SMOKE_PROJECT_LABEL || "links";
const TARGET_REPO = process.env.CODEX_LINKS_SMOKE_REPO || FILE_ENV.CODEX_LINKS_SMOKE_REPO || "andylitvinov-design/codex-links";
const TARGET_REPO_URL = process.env.CODEX_LINKS_SMOKE_REPO_URL || FILE_ENV.CODEX_LINKS_SMOKE_REPO_URL || "https://github.com/andylitvinov-design/codex-links";
const TARGET_WORKSPACE_PATH = process.env.CODEX_LINKS_SMOKE_WORKSPACE_PATH || FILE_ENV.CODEX_LINKS_SMOKE_WORKSPACE_PATH || "/Users/andriilitvinov/projects/MYPROJECTS/links";
const TARGET_CONTEXT_FILES = ["AGENTS.md", "README.md", "STATE.md"];
const clientId = `cloud-photo-smoke-${Date.now()}`;
const text = "If the attached image is visible and shows a red square with a white center, reply with exactly PHOTO_OK_RED. If the image is not visible, reply with exactly PHOTO_NOT_VISIBLE.";
const photoDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAV0lEQVR42u3Z0QkAIAgFwCZx/6HapZYQMbsHfircl6DrPJ4FAAAwFLAjWhUAAAAAQC9AdgAAAAByBlb3AQAAAABYZAAAAD8CXCUAAAAAZgN8KQEAAEpyAXtKwuUCTzFGAAAAAElFTkSuQmCC";

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postCommand() {
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
      text,
      dispatchMode: "cloud",
      targetExecutionMode: "cloud",
      targetRepo: TARGET_REPO,
      targetRepoUrl: TARGET_REPO_URL,
      targetContextFiles: TARGET_CONTEXT_FILES,
      targetWorkspacePath: TARGET_WORKSPACE_PATH,
          photo: {
            fileName: "photo.png",
            contentType: "image/png",
            size: 144,
            dataUrl: photoDataUrl
          }
        })
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.command?.id) {
    throw new Error(String(data?.error || "").trim() || `POST /api/commands failed with ${response.status}`);
  }

  if (String(data.command.dispatchMode || "").trim() !== "cloud") {
    throw new Error(`cloud photo create: expected dispatchMode=cloud, got ${String(data.command.dispatchMode || "").trim() || "empty"}.`);
  }

  return data.command;
}

async function pollCommand(id) {
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < 180000) {
    const response = await fetch(`${BASE_URL}/api/commands?id=${encodeURIComponent(id)}`, {
      headers: { accept: "application/json" }
    });
    const data = await response.json().catch(() => ({}));
    const command = data?.command || null;

    if (command) {
      const status = String(command.status || "").trim().toLowerCase();
      const dispatchMode = String(command.dispatchMode || "").trim();
      const cloudJobId = String(command.cloudJobId || "").trim();
      console.log(`status=${status || "unknown"} stage=${String(command.progressStage || "").trim() || "unknown"} cloudJobId=${cloudJobId || "none"}`);

      if (dispatchMode && dispatchMode !== "cloud") {
        throw new Error(`Trusted cloud photo smoke was routed incorrectly: dispatchMode=${dispatchMode}.`);
      }

      if ((status === "processing" || status === "answered") && !cloudJobId) {
        throw new Error("Trusted cloud photo smoke reached execution without a cloudJobId.");
      }

      if (status === "answered") {
        return command;
      }

      if (status === "failed") {
        throw new Error(String(command.errorMessage || "Command failed."));
      }
    }

    await sleep(5000);
  }

  throw new Error("Trusted cloud photo smoke timed out waiting for command completion.");
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

async function main() {
  console.log(`Submitting trusted cloud photo smoke command to ${BASE_URL}`);
  const created = await postCommand();
  console.log(`commandId=${created.id}`);
  const answered = await pollCommand(created.id);
  const replies = await fetchAssistantReplies(answered.id);
  const textReply = String(replies.at(-1)?.text || "").trim();

  if (!String(answered.cloudJobId || "").trim()) {
    throw new Error("Trusted cloud photo smoke finished without a cloudJobId.");
  }

  if (/PHOTO_NOT_VISIBLE/i.test(textReply)) {
    throw new Error(`Cloud photo was delivered, but Codex reported the image as not visible: ${textReply}`);
  }

  if (!/PHOTO_OK_RED/i.test(textReply)) {
    throw new Error(`Unexpected assistant reply: ${textReply || "empty"}`);
  }

  console.log(JSON.stringify({
    ok: true,
    commandId: answered.id,
    cloudJobId: answered.cloudJobId || "",
    progressStage: answered.progressStage || "",
    reply: textReply
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
