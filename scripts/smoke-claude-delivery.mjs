#!/usr/bin/env node

const BASE_URL = process.env.CODEX_LINKS_URL || "https://codex-links.pages.dev";
const TARGET_PROJECT_ID = process.env.CODEX_LINKS_SMOKE_PROJECT_ID || "links";
const TARGET_PROJECT_LABEL = process.env.CODEX_LINKS_SMOKE_PROJECT_LABEL || "links";
const TARGET_REPO = process.env.CODEX_LINKS_SMOKE_REPO || "andylitvinov-design/codex-links";
const TARGET_REPO_URL = process.env.CODEX_LINKS_SMOKE_REPO_URL || "https://github.com/andylitvinov-design/codex-links";
const TARGET_CONTEXT_FILES = ["AGENTS.md", "README.md", "STATE.md"];
const clientId = `claude-text-smoke-${Date.now()}`;
const text = "claude text probe ignore: reply with CLAUDE_TEXT_OK only";

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
      projectId: TARGET_PROJECT_ID,
      dispatchMode: "claude-bridge",
      targetExecutionMode: "claude",
      targetRepo: TARGET_REPO,
      targetRepoUrl: TARGET_REPO_URL,
      targetContextFiles: TARGET_CONTEXT_FILES,
      text
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
    const response = await fetch(`${BASE_URL}/api/commands?id=${encodeURIComponent(id)}`, {
      headers: { accept: "application/json" }
    });
    const data = await response.json().catch(() => ({}));
    const command = data?.command || null;

    if (command) {
      const status = String(command.status || "").trim().toLowerCase();
      console.log(`status=${status || "unknown"} stage=${String(command.progressStage || "").trim() || "unknown"} dispatchMode=${String(command.dispatchMode || "").trim() || "unknown"}`);

      if (status === "answered") {
        const replies = await fetchAssistantReplies(command.id);
        const matched = replies.find((reply) => /CLAUDE_TEXT_OK/i.test(String(reply?.text || "")));

        if (!matched) {
          throw new Error("Claude text smoke answered, but CLAUDE_TEXT_OK reply was not found.");
        }

        return command;
      }

      if (status === "failed") {
        throw new Error(String(command.errorMessage || "Claude text smoke failed."));
      }
    }

    await sleep(5000);
  }

  throw new Error("Claude text smoke timed out waiting for a reply.");
}

async function main() {
  console.log(`Submitting Claude text smoke command to ${BASE_URL}`);
  const command = await postCommand();
  console.log(`commandId=${command.id}`);
  const answered = await pollCommand(command.id);
  console.log(`Claude text smoke OK: command ${answered.id} answered via stage=${answered.progressStage || "unknown"} dispatchMode=${answered.dispatchMode || "unknown"}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
