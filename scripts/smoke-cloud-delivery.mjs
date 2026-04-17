#!/usr/bin/env node

const BASE_URL = process.env.CODEX_LINKS_URL || "https://codex-links.pages.dev"
const TARGET_REPO = process.env.CODEX_LINKS_SMOKE_REPO || "andylitvinov-design/codex-links"
const TARGET_REPO_URL = process.env.CODEX_LINKS_SMOKE_REPO_URL || "https://github.com/andylitvinov-design/codex-links"
const clientId = `smoke-${Date.now()}`
const text = "delivery-probe: reply in this Slack thread with OK only"

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
      threadId: "cloud:smoke",
      threadLabel: "Cloud Smoke",
      text,
      dispatchMode: "slack-codex-cloud",
      targetExecutionMode: "cloud",
      targetRepo: TARGET_REPO,
      targetRepoUrl: TARGET_REPO_URL,
      targetContextFiles: ["AGENTS.md", "README.md"]
    })
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok || !data?.command?.id) {
    throw new Error(String(data?.error || "").trim() || `POST /api/commands failed with ${response.status}`)
  }

  return data.command
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
      const status = String(command.status || "").trim().toLowerCase()
      const stage = String(command.progressStage || "").trim()

      console.log(`status=${status || "unknown"} stage=${stage || "unknown"}`)

      if (status === "answered") {
        return command
      }

      if (status === "failed") {
        throw new Error(String(command.errorMessage || "Command failed."))
      }
    }

    await sleep(5000)
  }

  throw new Error("Smoke test timed out waiting for a threaded Codex Cloud reply.")
}

async function main() {
  console.log(`Submitting cloud smoke command to ${BASE_URL}`)
  const created = await postCommand()
  console.log(`commandId=${created.id}`)
  const answered = await pollCommand(created.id)
  console.log(`Smoke OK: command ${answered.id} answered`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
