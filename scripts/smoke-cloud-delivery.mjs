#!/usr/bin/env node

const BASE_URL = process.env.CODEX_LINKS_URL || "https://codex-links.pages.dev";
const TARGET_PROJECT_ID = process.env.CODEX_LINKS_SMOKE_PROJECT_ID || "links";
const TARGET_PROJECT_LABEL = process.env.CODEX_LINKS_SMOKE_PROJECT_LABEL || "links";
const TARGET_REPO = process.env.CODEX_LINKS_SMOKE_REPO || "andylitvinov-design/codex-links";
const TARGET_REPO_URL = process.env.CODEX_LINKS_SMOKE_REPO_URL || "https://github.com/andylitvinov-design/codex-links";
const TARGET_WORKSPACE_PATH = process.env.CODEX_LINKS_SMOKE_WORKSPACE_PATH || "/Users/andriilitvinov/projects/MYPROJECTS/links";
const TARGET_CONTEXT_FILES = ["AGENTS.md", "README.md", "STATE.md"];
const clientId = `smoke-${Date.now()}`;
const text = "trusted cloud smoke: reply with exactly CLOUD_SMOKE_OK";

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function assertManifestContext(command, label) {
  const targetContextFiles = normalizeStringArray(command?.targetContextFiles);

  if (String(command?.projectId || command?.threadId || "").trim() !== TARGET_PROJECT_ID) {
    throw new Error(`${label}: unexpected projectId.`);
  }

  if (String(command?.targetRepo || "").trim() !== TARGET_REPO) {
    throw new Error(`${label}: unexpected targetRepo.`);
  }

  if (String(command?.targetRepoUrl || "").trim() !== TARGET_REPO_URL) {
    throw new Error(`${label}: unexpected targetRepoUrl.`);
  }

  if (String(command?.targetWorkspacePath || "").trim() !== TARGET_WORKSPACE_PATH) {
    throw new Error(`${label}: unexpected targetWorkspacePath.`);
  }

  if (targetContextFiles.join("::") !== TARGET_CONTEXT_FILES.join("::")) {
    throw new Error(`${label}: unexpected targetContextFiles.`);
  }
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
      targetWorkspacePath: TARGET_WORKSPACE_PATH
    })
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.command?.id) {
    throw new Error(String(data?.error || "").trim() || `POST /api/commands failed with ${response.status}`);
  }

  assertManifestContext(data.command, "cloud create");

  if (String(data.command.dispatchMode || "").trim() !== "cloud") {
    throw new Error(`cloud create: expected dispatchMode=cloud, got ${String(data.command.dispatchMode || "").trim() || "empty"}.`);
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
      assertManifestContext(command, "cloud poll");
      const status = String(command.status || "").trim().toLowerCase();
      const dispatchMode = String(command.dispatchMode || "").trim();
      const cloudJobId = String(command.cloudJobId || "").trim();

      console.log(`status=${status || "unknown"} stage=${String(command.progressStage || "").trim() || "unknown"} cloudJobId=${cloudJobId || "none"}`);

      if (dispatchMode && dispatchMode !== "cloud") {
        throw new Error(`Trusted cloud smoke was routed incorrectly: dispatchMode=${dispatchMode}.`);
      }

      if ((status === "processing" || status === "answered") && !cloudJobId) {
        throw new Error("Trusted cloud smoke reached execution without a cloudJobId.");
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

  throw new Error("Trusted cloud smoke timed out waiting for command completion.");
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
  console.log(`Submitting trusted cloud smoke command to ${BASE_URL}`);
  const created = await postCommand();
  console.log(`commandId=${created.id}`);
  const answered = await pollCommand(created.id);
  const replies = await fetchAssistantReplies(answered.id);
  const textReply = String(replies.at(-1)?.text || "").trim();

  if (!String(answered.cloudJobId || "").trim()) {
    throw new Error("Trusted cloud smoke finished without a cloudJobId.");
  }

  if (!/CLOUD_SMOKE_OK/i.test(textReply)) {
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
