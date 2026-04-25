#!/usr/bin/env node

const BASE_URL = process.env.CODEX_LINKS_URL || "https://codex-links.pages.dev"
const TARGET_PROJECT_ID = process.env.CODEX_LINKS_SMOKE_PROJECT_ID || "links"
const TARGET_PROJECT_LABEL = process.env.CODEX_LINKS_SMOKE_PROJECT_LABEL || "links"
const TARGET_REPO = process.env.CODEX_LINKS_SMOKE_REPO || "andylitvinov-design/codex-links"
const TARGET_REPO_URL = process.env.CODEX_LINKS_SMOKE_REPO_URL || "https://github.com/andylitvinov-design/codex-links"
const TARGET_WORKSPACE_PATH = process.env.CODEX_LINKS_SMOKE_WORKSPACE_PATH || "/Users/andriilitvinov/projects/MYPROJECTS/links"
const TARGET_CONTEXT_FILES = ["AGENTS.md", "README.md", "STATE.md"]
const FALLBACK_THREAD_ID = process.env.CODEX_LINKS_SMOKE_FALLBACK_THREAD_ID || ""
const FALLBACK_THREAD_LABEL = process.env.CODEX_LINKS_SMOKE_FALLBACK_THREAD_LABEL || ""
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || ""
const CLOUD_ROUTE = String(process.env.CODEX_LINKS_SMOKE_CLOUD_ROUTE || "slack").trim().toLowerCase()
const clientId = `smoke-${Date.now()}`
const text = "delivery-probe: reply with OK only"
const pollStartedAt = Date.now()

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchAssistantReplies(commandId) {
  const response = await fetch(`${BASE_URL}/api/messages?scope=public`, {
    headers: { accept: "application/json" }
  })
  const data = await response.json().catch(() => ({}))

  return Array.isArray(data?.messages)
    ? data.messages.filter((message) =>
        String(message?.commandId || "").trim() === String(commandId || "").trim()
        && String(message?.role || "").trim() === "assistant"
      )
    : []
}

async function fetchStatus() {
  const response = await fetch(`${BASE_URL}/api/status?_=${Date.now()}`, {
    headers: { accept: "application/json" }
  })
  const data = await response.json().catch(() => ({}))
  return data?.status || null
}

async function fetchSlackThreadReplies(channelId, threadTs) {
  if (!SLACK_BOT_TOKEN || !channelId || !threadTs) {
    return []
  }

  const url = new URL("https://slack.com/api/conversations.replies")
  url.searchParams.set("channel", channelId)
  url.searchParams.set("ts", threadTs)
  url.searchParams.set("inclusive", "true")
  url.searchParams.set("limit", "100")

  const response = await fetch(url.toString(), {
    headers: {
      authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      accept: "application/json"
    }
  })
  const data = await response.json().catch(() => ({}))

  if (!response.ok || !data?.ok) {
    throw new Error(`Slack replies fetch failed: ${String(data?.error || response.status).trim()}`)
  }

  return Array.isArray(data?.messages)
    ? data.messages.filter((message) => String(message?.ts || "").trim() !== String(threadTs || "").trim())
    : []
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : []
}

function assertManifestContext(command, label) {
  if (!command || typeof command !== "object") {
    throw new Error(`${label}: command payload is missing.`)
  }

  const projectId = String(command.projectId || command.threadId || "").trim()
  const targetRepo = String(command.targetRepo || "").trim()
  const targetRepoUrl = String(command.targetRepoUrl || "").trim()
  const targetWorkspacePath = String(command.targetWorkspacePath || "").trim()
  const targetContextFiles = normalizeStringArray(command.targetContextFiles)

  if (projectId !== TARGET_PROJECT_ID) {
    throw new Error(`${label}: expected projectId=${TARGET_PROJECT_ID}, got ${projectId || "empty"}.`)
  }

  if (targetRepo !== TARGET_REPO) {
    throw new Error(`${label}: expected targetRepo=${TARGET_REPO}, got ${targetRepo || "empty"}.`)
  }

  if (targetRepoUrl !== TARGET_REPO_URL) {
    throw new Error(`${label}: expected targetRepoUrl=${TARGET_REPO_URL}, got ${targetRepoUrl || "empty"}.`)
  }

  if (targetWorkspacePath !== TARGET_WORKSPACE_PATH) {
    throw new Error(`${label}: expected targetWorkspacePath=${TARGET_WORKSPACE_PATH}, got ${targetWorkspacePath || "empty"}.`)
  }

  if (targetContextFiles.join("::") !== TARGET_CONTEXT_FILES.join("::")) {
    throw new Error(`${label}: expected targetContextFiles=${TARGET_CONTEXT_FILES.join(", ")}, got ${targetContextFiles.join(", ") || "empty"}.`)
  }
}

function assertDirectCloudState(command, label) {
  const dispatchMode = String(command?.dispatchMode || "").trim()
  const requestedExecutor = String(command?.requestedExecutor || "").trim()
  const actualExecutor = String(command?.actualExecutor || "").trim()
  const expectedDispatchMode = CLOUD_ROUTE === "direct" ? "cloud" : "slack-codex-cloud"
  const expectedRequestedExecutor = CLOUD_ROUTE === "direct" ? "direct-openai" : "cloud-via-slack"
  const allowedAnsweredExecutors = CLOUD_ROUTE === "direct"
    ? new Set(["direct-openai", "bridge"])
    : new Set(["cloud-via-slack", "bridge", "claude"])

  if (dispatchMode !== expectedDispatchMode && !(expectedDispatchMode === "slack-codex-cloud" && dispatchMode === "local-bridge")) {
    throw new Error(`${label}: expected dispatchMode=${expectedDispatchMode} for cloud request, got ${dispatchMode || "empty"}.`)
  }

  if (requestedExecutor !== expectedRequestedExecutor) {
    throw new Error(`${label}: expected requestedExecutor=${expectedRequestedExecutor}, got ${requestedExecutor || "empty"}.`)
  }

  if (
    String(command?.status || "").trim().toLowerCase() === "answered"
    && !allowedAnsweredExecutors.has(actualExecutor)
  ) {
    throw new Error(`${label}: expected actualExecutor in ${Array.from(allowedAnsweredExecutors).join(" or ")} on answered command, got ${actualExecutor || "empty"}.`)
  }
}

async function postCommand() {
  const startedAt = Date.now()
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
      fallbackThreadId: FALLBACK_THREAD_ID,
      fallbackThreadLabel: FALLBACK_THREAD_LABEL,
      text,
      dispatchMode: CLOUD_ROUTE === "direct" ? "direct-openai" : "cloud",
      targetExecutionMode: "cloud",
      targetRepo: TARGET_REPO,
      targetRepoUrl: TARGET_REPO_URL,
      targetContextFiles: TARGET_CONTEXT_FILES
    })
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok || !data?.command?.id) {
    throw new Error(String(data?.error || "").trim() || `POST /api/commands failed with ${response.status}`)
  }

  assertManifestContext(data.command, "cloud create")
  assertDirectCloudState(data.command, "cloud create")
  return {
    command: data.command,
    createAckMs: Date.now() - startedAt
  }
}

async function pollCommand(id) {
  const startedAt = Date.now()

  while ((Date.now() - startedAt) < 180000) {
    const response = await fetch(`${BASE_URL}/api/commands?id=${encodeURIComponent(id)}`, {
      headers: { accept: "application/json" }
    })
    const data = await response.json().catch(() => ({}))
    const command = data?.command || null

    if (command) {
      assertManifestContext(command, "cloud poll")
      assertDirectCloudState(command, "cloud poll")
      const status = String(command.status || "").trim().toLowerCase()
      const stage = String(command.progressStage || "").trim()

      console.log(`status=${status || "unknown"} stage=${stage || "unknown"} dispatchMode=${String(command.dispatchMode || "").trim() || "unknown"}`)

      if (status === "answered") {
        return command
      }

      if (
        String(command?.slackChannelId || "").trim()
        && String(command?.slackThreadTs || command?.slackMessageTs || "").trim()
        && SLACK_BOT_TOKEN
      ) {
        const replies = await fetchSlackThreadReplies(
          String(command.slackChannelId || "").trim(),
          String(command.slackThreadTs || command.slackMessageTs || "").trim()
        )
        const matched = replies.find((reply) => /(^|\b)OK(\b|$)/i.test(String(reply?.text || "").trim()))

        if (matched) {
          return command
        }
      }

      if (status === "acked") {
        const replies = await fetchAssistantReplies(command.id)

        if (replies.length) {
          return command
        }
      }

      if (status === "failed") {
        throw new Error(String(command.errorMessage || "Command failed."))
      }
    }

    await sleep(5000)
  }

  throw new Error("Smoke test timed out waiting for a cloud reply or fallback-matched reply.")
}

async function main() {
  console.log(`Submitting ${CLOUD_ROUTE} cloud smoke command to ${BASE_URL}`)
  const created = await postCommand()
  console.log(`commandId=${created.command.id}`)
  const answered = await pollCommand(created.command.id)
  const status = await fetchStatus()

  if (CLOUD_ROUTE !== "direct" && String(status?.slackActor?.validationStatus || "").trim() !== "validated") {
    throw new Error(`Expected /api/status slackActor.validationStatus=validated, got ${String(status?.slackActor?.validationStatus || "").trim() || "empty"}.`)
  }

  const report = {
    path: "cloud",
    createAckMs: created.createAckMs,
    executorVisibleMs: Number(answered?.latencyBreakdown?.dispatchToFirstAckMs ?? null),
    firstReplyVisibleMs: Number(answered?.latencyBreakdown?.dispatchToFirstReplyMs ?? null),
    doneMs: Date.now() - pollStartedAt,
    stage: answered?.deliveryStage || answered?.progressStage || answered?.status || "unknown",
    dispatchMode: String(answered?.dispatchMode || "").trim() || "unknown"
  }
  console.log(JSON.stringify({ latencyReport: report }, null, 2))
  console.log(`Smoke OK: command ${answered.id} answered via stage=${answered.progressStage || "unknown"} dispatchMode=${answered.dispatchMode || "unknown"}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
