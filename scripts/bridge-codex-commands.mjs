import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseUrl = process.env.LINKS_BASE_URL || "https://codex-links.pages.dev";
const token = process.env.LINKS_WRITE_TOKEN;
const codexBin = process.env.CODEX_BIN || "/Users/andriilitvinov/.npm-global/bin/codex";

if (!token) {
  console.error("Set LINKS_WRITE_TOKEN before running bridge.");
  process.exit(1);
}

function getPendingUrl() {
  const url = new URL("/api/commands", baseUrl);
  url.searchParams.set("status", "pending");
  url.searchParams.set("token", token);
  return url.toString();
}

function getMessagesUrl() {
  return new URL("/api/messages", baseUrl).toString();
}

function getStatusUrl() {
  return new URL("/api/status", baseUrl).toString();
}

function getFileExtension(contentType) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/gif") return "gif";
  return "jpg";
}

function isRealThreadId(value) {
  return /^(urn:uuid:)?[0-9a-fA-F-]{36}$/.test(String(value || "").trim());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getLegacyLinksThreadId() {
  try {
    const toml = await readFile(`${process.env.HOME}/.codex/automations/links-inbox/automation.toml`, "utf8");
    const match = toml.match(/^target_thread_id = "([^"]+)"/m);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

async function materializePhoto(command) {
  const photo = command?.photo;

  if (!photo?.dataUrl) {
    return null;
  }

  const match = /^data:([^;]+);base64,(.+)$/i.exec(String(photo.dataUrl));

  if (!match) {
    throw new Error(`Invalid photo payload for command ${command.id}.`);
  }

  const contentType = String(photo.contentType || match[1] || "image/jpeg").toLowerCase();
  const base64 = match[2];
  const ext = getFileExtension(contentType);
  const dir = join(tmpdir(), "codex-links-bridge");
  const path = join(dir, `${command.id}.${ext}`);

  await mkdir(dir, { recursive: true });
  await writeFile(path, Buffer.from(base64, "base64"));
  return path;
}

function buildInput(command, photoPath) {
  const items = [];
  const text = String(command?.text || "").trim();
  const createdAt = String(command?.createdAt || "").trim();
  const prefix = createdAt ? `Site command (${createdAt})` : "Site command";

  if (text) {
    items.push({
      type: "text",
      text: `${prefix}: ${text}`,
      text_elements: []
    });
  }

  if (photoPath) {
    items.push({
      type: "local_image",
      path: photoPath
    });
  }

  return items;
}

async function waitForTurnCompletion(request, threadId, turnId, timeoutMs = 10 * 60 * 1000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const response = await request("thread/read", {
      threadId,
      includeTurns: true
    });
    const turns = Array.isArray(response?.thread?.turns) ? response.thread.turns : [];
    const turn = turns.find((entry) => String(entry?.id || "").trim() === turnId);

    if (turn) {
      const status = String(turn.status || "").trim().toLowerCase();

      if (status === "completed") {
        return turn;
      }

      if (status === "interrupted" || status === "errored" || status === "failed") {
        throw new Error(`Turn ${turnId} finished with status ${status}.`);
      }
    }

    await sleep(1500);
  }

  throw new Error(`Timed out waiting for turn ${turnId} in thread ${threadId}.`);
}

function runCodexResume(threadId, prompt, photoPath) {
  return new Promise((resolve, reject) => {
    const outputPath = join(tmpdir(), `codex-links-output-${crypto.randomUUID()}.txt`);
    const args = [
      "exec",
      "resume",
      threadId,
      prompt,
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "-c",
      'service_tier="fast"',
      "-o",
      outputPath
    ];

    if (photoPath) {
      args.push("-i", photoPath);
    }

    execFile(codexBin, args, {
      cwd: process.cwd(),
      timeout: 45 * 1000,
      maxBuffer: 10 * 1024 * 1024
    }, async (error, stdout, stderr) => {
      const result = {
        stdout: String(stdout || "").trim(),
        stderr: String(stderr || "").trim(),
        output: ""
      };

      try {
        result.output = String(await readFile(outputPath, "utf8") || "").trim();
      } catch {}

      if (error) {
        reject(new Error(result.stderr || result.stdout || error.message));
        return;
      }

      resolve(result);
    });
  });
}

async function fetchPendingCommands() {
  const response = await fetch(getPendingUrl(), {
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to load pending commands: ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data.commands) ? data.commands : [];
}

async function acknowledge(ids) {
  if (!ids.length) {
    return;
  }

  const response = await fetch(new URL("/api/commands", baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-write-token": token
    },
    body: JSON.stringify({
      action: "ack",
      ids
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to ack commands: ${response.status} ${body}`);
  }
}

async function syncMessages(messages) {
  if (!messages.length) {
    return;
  }

  const response = await fetch(getMessagesUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-write-token": token
    },
    body: JSON.stringify({ messages })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to sync messages: ${response.status} ${body}`);
  }
}

async function publishBridgeStatus(status) {
  const response = await fetch(getStatusUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-write-token": token
    },
    body: JSON.stringify({ status })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to publish bridge status: ${response.status} ${body}`);
  }
}

function createMessageId(threadId, timestamp, text) {
  return crypto
    .createHash("sha1")
    .update(`${threadId}|${timestamp}|${text}`)
    .digest("hex");
}

function getImmediateAssistantText(result) {
  const output = String(result?.output || "").trim();

  if (output) {
    return output;
  }

  const stdout = String(result?.stdout || "").trim();

  if (!stdout) {
    return "";
  }

  return stdout;
}

function createAssistantMessage(command, threadId, threadLabel, text, createdAt = new Date().toISOString()) {
  return {
    id: createMessageId(threadId, createdAt, text),
    clientId: command.clientId,
    commandId: command.id,
    threadId,
    threadLabel,
    role: "assistant",
    text,
    createdAt
  };
}

function getFailureAssistantText(error) {
  const message = String(error?.message || "").trim();

  if (/timed?\s*out|ETIMEDOUT|SIGTERM|killed/i.test(message)) {
    return "Codex не ответил вовремя. Я остановил этот запрос, чтобы очередь не зависала. Повторите запрос короче или откройте Codex на Mac для длинной задачи.";
  }

  return `Не удалось получить ответ от Codex: ${message || "неизвестная ошибка"}`;
}

const pending = (await fetchPendingCommands())
  .sort((left, right) => String(right?.createdAt || "").localeCompare(String(left?.createdAt || "")));

const completed = [];
const failed = [];
const syncedMessages = [];

const legacyLinksThreadId = await getLegacyLinksThreadId();

await publishBridgeStatus({
  bridgeOnline: true,
  state: "running",
  lastRunAt: new Date().toISOString(),
  pendingCount: pending.length,
  oldestPendingAt: pending.length ? pending[pending.length - 1]?.createdAt || "" : "",
  lastDeliveredCount: 0,
  lastError: ""
});

for (const command of pending) {
  try {
    let threadId = String(command?.threadId || "").trim();
    const threadLabel = String(command?.threadLabel || "").trim();

    if (!isRealThreadId(threadId)) {
      if (
        threadId.toLowerCase() === "links" ||
        threadLabel.toLowerCase() === "links"
      ) {
        threadId = legacyLinksThreadId || "";
      }
    }

    if (!threadId) {
      throw new Error("Missing threadId.");
    }

    const photoPath = await materializePhoto(command);
    const input = buildInput(command, photoPath);

    if (!input.length) {
      throw new Error("Command has no deliverable content.");
    }

    const prompt = input
      .filter((item) => item?.type === "text" && item?.text)
      .map((item) => String(item.text).trim())
      .filter(Boolean)
      .join("\n\n");

    if (!prompt && !photoPath) {
      throw new Error(`Command ${command.id} has no CLI-deliverable content.`);
    }

    const result = await runCodexResume(threadId, prompt || "See attached image and respond.", photoPath);
    const ackedAt = new Date().toISOString();
    const assistantText = getImmediateAssistantText(result);

    completed.push({
      id: command.id,
      threadId,
      threadLabel: command.threadLabel || threadId,
      ackedAt
    });

    if (assistantText) {
      syncedMessages.push(createAssistantMessage(command, threadId, command.threadLabel || threadId, assistantText, ackedAt));
    }
  } catch (error) {
    const ackedAt = new Date().toISOString();
    const threadId = String(command?.threadId || "").trim() || legacyLinksThreadId || "";
    const threadLabel = String(command?.threadLabel || "").trim() || threadId;

    completed.push({
      id: command.id,
      threadId,
      threadLabel,
      ackedAt
    });
    syncedMessages.push(createAssistantMessage(command, threadId, threadLabel, getFailureAssistantText(error), ackedAt));
    failed.push({
      id: command.id,
      error: error.message
    });
  }
}

await acknowledge(completed.map((command) => command.id));
await syncMessages(syncedMessages);

const remainingPending = await fetchPendingCommands();

await publishBridgeStatus({
  bridgeOnline: true,
  state: failed.length ? "degraded" : "idle",
  lastRunAt: new Date().toISOString(),
  lastSuccessAt: failed.length ? "" : new Date().toISOString(),
  pendingCount: remainingPending.length,
  oldestPendingAt: remainingPending.length
    ? remainingPending
        .slice()
        .sort((left, right) => String(left?.createdAt || "").localeCompare(String(right?.createdAt || "")))[0]?.createdAt || ""
    : "",
  lastDeliveredCount: completed.length,
  lastError: failed[0]?.error || ""
});

console.log(JSON.stringify({
  ok: failed.length === 0,
  delivered: completed.length,
  failed
}, null, 2));

if (failed.length) {
  process.exit(1);
}
