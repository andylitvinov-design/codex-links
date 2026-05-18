#!/usr/bin/env node
import os from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434/api/generate";
const DEFAULT_LMSTUDIO_URL = "http://127.0.0.1:1234/v1/chat/completions";
const DEFAULT_MODEL = "qwen2.5-coder:7b";
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_LEASE_MS = 180000;

export function readConfig(env = process.env) {
  return {
    baseUrl: String(env.CODEX_LINKS_BASE_URL || env.LINKS_BASE_URL || "https://codex-links.pages.dev").replace(/\/$/, ""),
    writeToken: String(env.LINKS_WRITE_TOKEN || "").trim(),
    provider: String(env.CODE_COPILOT_LOCAL_PROVIDER || "ollama").trim().toLowerCase(),
    model: String(env.CODE_COPILOT_MODEL || DEFAULT_MODEL).trim(),
    ollamaUrl: String(env.CODE_COPILOT_OLLAMA_URL || DEFAULT_OLLAMA_URL).trim(),
    lmstudioUrl: String(env.CODE_COPILOT_LMSTUDIO_URL || DEFAULT_LMSTUDIO_URL).trim(),
    pollIntervalMs: Math.max(1000, Number(env.CODE_COPILOT_POLL_INTERVAL_MS || DEFAULT_POLL_INTERVAL_MS)),
    leaseMs: Math.max(5000, Number(env.CODE_COPILOT_LEASE_MS || DEFAULT_LEASE_MS)),
    once: String(env.CODE_COPILOT_ONCE || "").trim() === "1"
  };
}

function requireConfig(config) {
  const missing = [];
  if (!config.baseUrl) missing.push("CODEX_LINKS_BASE_URL or LINKS_BASE_URL");
  if (!config.writeToken) missing.push("LINKS_WRITE_TOKEN");
  if (!config.model) missing.push("CODE_COPILOT_MODEL");
  if (missing.length) throw new Error(`Missing required config: ${missing.join(", ")}`);
}

function safeError(error) {
  return String(error?.message || error || "Unknown error").slice(0, 500);
}

function log(message, extra = {}) {
  const safe = { ...extra };
  delete safe.prompt;
  delete safe.text;
  delete safe.effectivePrompt;
  console.log(JSON.stringify({ at: new Date().toISOString(), message, ...safe }));
}

async function commandApi(config, payload) {
  const response = await fetch(`${config.baseUrl}/api/commands`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-write-token": config.writeToken
    },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let body = null;

  try { body = text ? JSON.parse(text) : null; } catch { body = null; }

  if (!response.ok || body?.error) {
    throw new Error(body?.error || text.slice(0, 300) || `Command API failed with HTTP ${response.status}`);
  }

  return body || {};
}

export async function claimNextCodeCopilotCommand(config, processorId) {
  const body = await commandApi(config, {
    action: "claim",
    processorId,
    leaseMs: config.leaseMs,
    dispatchMode: "code-copilot-bridge",
    textOnly: true
  });
  return body.command || null;
}

export async function markProgress(config, command, processorId, progressStage = "code-copilot-reviewing") {
  return commandApi(config, {
    action: "progress",
    id: command.id,
    processorId,
    progressStage,
    progressUpdatedAt: new Date().toISOString()
  });
}

export async function markAnswer(config, command, answerText) {
  const now = new Date().toISOString();
  return commandApi(config, {
    action: "answer",
    id: command.id,
    actualExecutor: "code-copilot-bridge",
    progressStage: "answered",
    completedAt: now,
    firstAckAt: command.firstAckAt || command.dispatchedAt || now,
    resultAt: now,
    deliveryStatus: "answered",
    deliveryFeedback: String(answerText || "").slice(0, 12000)
  });
}

export async function markFailure(config, command, error) {
  return commandApi(config, {
    action: "fail",
    id: command.id,
    actualExecutor: "code-copilot-bridge",
    progressStage: "failed",
    errorMessage: safeError(error),
    lastDiagnosticCode: "code_copilot_bridge_failed",
    lastDiagnosticDetail: safeError(error)
  });
}

export function buildReviewerPrompt(command) {
  const prompt = String(command?.effectivePrompt || command?.text || "").trim();
  return `You are Code Copilot Reviewer, an independent senior programming assistant.

Do not patch code. Review the debugging prompt and judge whether it will lead Codex to the correct root cause and safe fix. Focus on failing-layer proof, missing evidence, live verification, tests, safety, and finance semantics. Return concise structured feedback.

Output format:
1. Verdict: pass / needs improvement / fail
2. Prompt score: 0-10
3. Problem understanding
4. Missing evidence/checks
5. Risky or vague instructions
6. Recommended additions
7. Rewritten improved prompt

For Ezohata Ledger, enforce:
- UI → API route → provider/import → normalization → ledger save → balance → analytics
- /api/status deploy/source check
- latest PR/commit check
- status/content-type/body excerpt for APIs
- amount_net invariant
- source=unknown not excluding valid amount_net rows
- provider transport separate from balance logic
- gross/net/fee/source semantics
- structured provider errors

Prompt to review:
${prompt}`;
}

export function parseOllamaResponse(body) {
  if (!body || typeof body !== "object") return "";
  return String(body.response || body.message?.content || "").trim();
}

export function parseLmStudioResponse(body) {
  if (!body || typeof body !== "object") return "";
  return String(body.choices?.[0]?.message?.content || body.choices?.[0]?.text || "").trim();
}

async function callOllama(config, prompt) {
  const response = await fetch(config.ollamaUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: config.model, prompt, stream: false })
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || `Ollama HTTP ${response.status}`);
  const answer = parseOllamaResponse(body);
  if (!answer) throw new Error("Ollama returned an empty response.");
  return answer;
}

async function callLmStudio(config, prompt) {
  const response = await fetch(config.lmstudioUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: "You are Code Copilot Reviewer, an independent senior programming assistant. Do not patch code. Review prompts and return concise structured feedback." },
        { role: "user", content: prompt }
      ],
      temperature: 0.2
    })
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message || body?.error || `LM Studio HTTP ${response.status}`);
  const answer = parseLmStudioResponse(body);
  if (!answer) throw new Error("LM Studio returned an empty response.");
  return answer;
}

export async function callLocalModel(config, prompt) {
  if (config.provider === "lmstudio" || config.provider === "lm-studio") return callLmStudio(config, prompt);
  if (config.provider === "ollama") return callOllama(config, prompt);
  throw new Error(`Unsupported CODE_COPILOT_LOCAL_PROVIDER: ${config.provider}`);
}

export async function processCommand(config, command, processorId) {
  const started = Date.now();
  await markProgress(config, command, processorId);
  const reviewerPrompt = buildReviewerPrompt(command);
  const answer = await callLocalModel(config, reviewerPrompt);
  await markAnswer(config, command, answer);
  log("code-copilot command answered", {
    commandId: command.id,
    provider: config.provider,
    model: config.model,
    durationMs: Date.now() - started
  });
  return answer;
}

async function loop() {
  const config = readConfig();
  requireConfig(config);
  const processorId = `code-copilot-bridge:${os.hostname()}:${process.pid}`;
  log("code-copilot bridge started", { provider: config.provider, model: config.model, baseUrl: config.baseUrl, once: config.once });

  while (true) {
    let command = null;
    try {
      command = await claimNextCodeCopilotCommand(config, processorId);
      if (!command) {
        if (config.once) break;
        await sleep(config.pollIntervalMs);
        continue;
      }

      log("code-copilot command claimed", { commandId: command.id, provider: config.provider, model: config.model });
      await processCommand(config, command, processorId);
    } catch (error) {
      log("code-copilot bridge error", { commandId: command?.id || "", error: safeError(error) });
      if (command?.id) {
        try { await markFailure(config, command, error); }
        catch (failureError) { log("code-copilot fail update error", { commandId: command.id, error: safeError(failureError) }); }
      }
      if (config.once) break;
      await sleep(config.pollIntervalMs);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loop().catch((error) => {
    console.error(`[code-copilot-bridge] ${safeError(error)}`);
    process.exit(1);
  });
}
