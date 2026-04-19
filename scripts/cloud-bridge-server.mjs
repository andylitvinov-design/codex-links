#!/usr/bin/env node

import http from "node:http";
import crypto from "node:crypto";

import { verifyBridgeRequestSignature } from "./cloud-bridge-auth.mjs";
import { createCloudBridgeHealthPayload, processTrustedCloudJob } from "./cloud-bridge-runner.mjs";
import { classifyTrustedCloudFailure, getFailureAssistantText } from "./shared-codex-executor.mjs";

const LINKS_BASE_URL = String(process.env.LINKS_BASE_URL || "https://codex-links.pages.dev").trim().replace(/\/+$/, "");
const LINKS_WRITE_TOKEN = String(process.env.LINKS_WRITE_TOKEN || "").trim();
const CLOUD_BRIDGE_SHARED_SECRET = String(process.env.CLOUD_BRIDGE_SHARED_SECRET || "").trim();
const CLOUD_BRIDGE_BIND_HOST = String(process.env.CLOUD_BRIDGE_BIND_HOST || "127.0.0.1").trim();
const CLOUD_BRIDGE_PORT = Number(process.env.CLOUD_BRIDGE_PORT || 8788);

if (!LINKS_WRITE_TOKEN) {
  console.error("Missing LINKS_WRITE_TOKEN for cloud bridge.");
  process.exit(1);
}

if (!CLOUD_BRIDGE_SHARED_SECRET) {
  console.error("Missing CLOUD_BRIDGE_SHARED_SECRET for cloud bridge.");
  process.exit(1);
}

const queue = [];
let draining = false;
let lastError = "";
let lastCompletedAt = "";

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;

      if (body.length > 8_000_000) {
        reject(new Error("Request body is too large."));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function createAssistantMessage(command, jobId, text, createdAt = new Date().toISOString()) {
  return {
    id: `cloud:${String(command?.id || "").trim()}:${jobId}`,
    clientId: command.clientId,
    commandId: command.id,
    threadId: command.threadId,
    threadLabel: command.threadLabel,
    role: "assistant",
    text,
    createdAt
  };
}

function extractPrUrl(text) {
  const match = String(text || "").match(/https:\/\/github\.com\/[^\s)]+\/pull\/\d+/i);
  return match ? match[0] : "";
}

async function postJson(path, payload) {
  const response = await fetch(`${LINKS_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-write-token": LINKS_WRITE_TOKEN
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`POST ${path} failed: ${response.status} ${body.trim()}`);
  }

  return response.json().catch(() => ({}));
}

async function syncMessages(messages) {
  if (!messages.length) {
    return;
  }

  await postJson("/api/messages", { messages });
}

async function updateProgress(commandId, cloudJobId, progressStage, progressMessage) {
  await postJson("/api/commands", {
    action: "progress",
    id: commandId,
    progressStage,
    progressUpdatedAt: new Date().toISOString(),
    cloudJobId,
    progressMessage
  });
}

async function markAnswered(command, jobId, assistantText, acceptedAt) {
  const completedAt = new Date().toISOString();
  await syncMessages([createAssistantMessage(command, jobId, assistantText, completedAt)]);
  await postJson("/api/commands", {
    action: "answer",
    id: command.id,
    progressStage: "answered",
    completedAt,
    resultAt: completedAt,
    firstAckAt: acceptedAt,
    firstExecutorAckSeenAt: acceptedAt,
    firstReplySeenAt: completedAt,
    replyIngestedAt: completedAt,
    actualDispatchMode: "cloud",
    cloudJobId: jobId,
    progressMessage: "Trusted cloud bridge completed the job.",
    prUrl: extractPrUrl(assistantText)
  });
  await publishStatus("idle", {
    lastCompletedAt: completedAt,
    lastSuccessAt: completedAt,
    lastDeliveredCount: 1,
    lastError: ""
  });
}

async function markFailed(command, jobId, acceptedAt, error) {
  const completedAt = new Date().toISOString();
  const diagnosticCode = classifyTrustedCloudFailure(error);
  const diagnosticDetail = String(error?.message || "").trim().slice(0, 500);
  await postJson("/api/commands", {
    action: "fail",
    id: command.id,
    progressStage: "failed",
    completedAt,
    resultAt: completedAt,
    firstAckAt: acceptedAt,
    firstExecutorAckSeenAt: acceptedAt,
    actualDispatchMode: "cloud",
    cloudJobId: jobId,
    progressMessage: diagnosticCode === "cloud_bridge_timeout"
      ? "Trusted cloud bridge timed out while running Codex."
      : diagnosticCode === "cloud_bridge_photo_not_visible"
        ? "Trusted cloud bridge could not read visible photo content."
        : diagnosticCode === "cloud_bridge_no_final_answer"
          ? "Trusted cloud bridge completed without a final assistant reply."
          : "Trusted cloud bridge failed the job.",
    lastDiagnosticCode: diagnosticCode,
    lastDiagnosticDetail: diagnosticDetail,
    errorMessage: getFailureAssistantText(error)
  });
  await publishStatus("degraded", {
    lastCompletedAt: completedAt,
    lastError: diagnosticDetail || "Trusted cloud bridge execution failed."
  });
}

async function publishStatus(state, extra = {}) {
  await postJson("/api/status", {
    status: {
      bridgeOnline: true,
      dispatchMode: "cloud",
      executorLabel: "Trusted Codex Cloud",
      state,
      lastRunAt: new Date().toISOString(),
      ...(extra || {})
    }
  });
}

async function processJob(job) {
  const result = await processTrustedCloudJob(job, {
    updateProgress,
    markAnswered,
    markFailed,
    publishStatus
  });

  if (result.ok) {
    lastError = "";
    lastCompletedAt = new Date().toISOString();
    return;
  }

  lastError = String(result.error?.message || "Trusted cloud bridge execution failed.").trim();
  lastCompletedAt = new Date().toISOString();
}

async function drainQueue() {
  if (draining) {
    return;
  }

  draining = true;

  try {
    while (queue.length) {
      const job = queue.shift();
      await processJob(job);
    }
  } finally {
    draining = false;
  }
}

async function handleCommandSubmission(request, response) {
  const bodyText = await readRequestBody(request);
  const verification = verifyBridgeRequestSignature({
    secret: CLOUD_BRIDGE_SHARED_SECRET,
    method: request.method,
    path: new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname,
    timestamp: request.headers["x-codex-bridge-timestamp"],
    bodyText,
    signature: request.headers["x-codex-bridge-signature"],
    bodySha256: request.headers["x-codex-bridge-body-sha256"]
  });

  if (!verification.ok) {
    sendJson(response, 401, { error: verification.error });
    return;
  }

  let payload;

  try {
    payload = JSON.parse(bodyText);
  } catch {
    sendJson(response, 400, { error: "Request body must be valid JSON." });
    return;
  }

  const command = payload?.command;

  if (!command || typeof command !== "object" || !String(command.id || "").trim()) {
    sendJson(response, 400, { error: "Command payload is required." });
    return;
  }

  const jobId = crypto.randomUUID();
  const acceptedAt = new Date().toISOString();
  queue.push({
    jobId,
    acceptedAt,
    command
  });

  void drainQueue();

  sendJson(response, 202, {
    ok: true,
    jobId,
    acceptedAt,
    progressMessage: queue.length > 1 || draining
      ? "Trusted cloud bridge queued the job."
      : "Trusted cloud bridge accepted the job."
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  try {
    if (request.method === "GET" && url.pathname === "/healthz") {
      sendJson(response, 200, createCloudBridgeHealthPayload({ busy: draining }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/commands") {
      await handleCommandSubmission(request, response);
      return;
    }

    sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    sendJson(response, 500, { error: String(error?.message || "Internal error.") });
  }
});

server.listen(CLOUD_BRIDGE_PORT, CLOUD_BRIDGE_BIND_HOST, () => {
  console.log(JSON.stringify({
    ok: true,
    host: CLOUD_BRIDGE_BIND_HOST,
    port: CLOUD_BRIDGE_PORT,
    linksBaseUrl: LINKS_BASE_URL
  }, null, 2));
});
