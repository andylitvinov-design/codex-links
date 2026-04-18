import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withCodexAppServer } from "./codex-app-rpc.mjs";

const baseUrl = process.env.LINKS_BASE_URL || "https://codex-links.pages.dev";
const token = process.env.LINKS_WRITE_TOKEN;
const EXEC_TIMEOUT_MS = 4 * 60 * 1000;
const CLAIM_LEASE_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15 * 1000;
const BRIDGE_RUN_TIMEOUT_MS = 30 * 60 * 1000;
const LEASE_EXTENSION_MS = 5 * 60 * 1000;
const TURN_PROGRESS_HEARTBEAT_MS = 15 * 1000;
const IDLE_DRAIN_WINDOW_MS = 15 * 60 * 1000;
const IDLE_DRAIN_POLL_MS = 1500;
const LINKS_REPO_CWD = "/Users/andriilitvinov/projects/MYPROJECTS/links";
const LOG_DIR = `${process.env.HOME || ""}/Library/Logs`;
const BRIDGE_LOG_PATH = `${LOG_DIR}/codex-links-bridge.log`;
const BRIDGE_ERROR_LOG_PATH = `${LOG_DIR}/codex-links-bridge.error.log`;
const FETCH_RETRY_LIMIT = 3;
const FETCH_RETRY_DELAY_MS = 1200;
const OCR_TIMEOUT_MS = 20 * 1000;

if (!token) {
  console.error("Set LINKS_WRITE_TOKEN before running bridge.");
  process.exit(1);
}

const bridgeRunWatchdog = setTimeout(() => {
  void appendBridgeErrorLog("bridgeRunWatchdog", new Error(`Bridge run exceeded ${BRIDGE_RUN_TIMEOUT_MS}ms and was aborted.`));
  console.error(`Bridge run exceeded ${BRIDGE_RUN_TIMEOUT_MS}ms and was aborted.`);
  process.exit(1);
}, BRIDGE_RUN_TIMEOUT_MS);

bridgeRunWatchdog.unref();

async function appendBridgeErrorLog(context, error, extra = {}) {
  const message = error instanceof Error ? error.stack || error.message : String(error || "Unknown error");
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    context,
    ...extra,
    error: message
  }) + "\n";

  try {
    await writeFile(BRIDGE_ERROR_LOG_PATH, line, { flag: "a" });
  } catch (writeError) {
    console.error("Failed to write bridge error log", writeError instanceof Error ? writeError.message : String(writeError));
  }
}

async function appendBridgeLog(path, level, message, meta = {}) {
  try {
    await mkdir(LOG_DIR, { recursive: true });
    await appendFile(path, `${JSON.stringify({
      at: new Date().toISOString(),
      level,
      message,
      ...meta
    })}\n`, "utf8");
  } catch (writeError) {
    console.error("Failed to write bridge log", writeError instanceof Error ? writeError.message : String(writeError));
  }
}

async function logBridgeInfo(message, meta = {}) {
  await appendBridgeLog(BRIDGE_LOG_PATH, "info", message, meta);
}

async function logBridgeError(message, error, meta = {}) {
  const details = error instanceof Error
    ? {
        errorName: error.name,
        errorMessage: error.message,
        stack: error.stack
      }
    : {
        errorMessage: String(error || "Unknown error")
      };
  await appendBridgeLog(BRIDGE_ERROR_LOG_PATH, "error", message, {
    ...meta,
    ...details
  });
}

function getPendingUrl() {
  const url = new URL("/api/commands", baseUrl);
  url.searchParams.set("scope", "recent");
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
  if (contentType === "image/heic") return "heic";
  if (contentType === "image/heif") return "heif";
  return "jpg";
}

function canPassImageDirectly(contentType) {
  return contentType === "image/jpeg"
    || contentType === "image/png"
    || contentType === "image/webp"
    || contentType === "image/gif";
}

function execFileAsync(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(String(stderr || error.message || `Failed to run ${file}`)));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function execFileWithOptionsAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(String(stderr || error.message || `Failed to run ${file}`)));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function isRealThreadId(value) {
  return /^(urn:uuid:)?[0-9a-fA-F-]{36}$/.test(String(value || "").trim());
}

function normalizeThreadLookupValue(value) {
  return String(value || "").trim().toLowerCase();
}

let cachedStoredThreadsPromise = null;

async function fetchStoredThreads() {
  if (!cachedStoredThreadsPromise) {
    cachedStoredThreadsPromise = (async () => {
      try {
        const response = await fetchWithRetry(`${baseUrl.replace(/\/$/, "")}/api/threads`, {
          headers: {
            accept: "application/json"
          }
        }, FETCH_TIMEOUT_MS, "fetchStoredThreads");

        if (!response.ok) {
          throw new Error(`Failed to load stored threads: ${response.status}`);
        }

        const data = await response.json().catch(() => ({}));
        return Array.isArray(data?.threads) ? data.threads : [];
      } catch {
        return [];
      }
    })();
  }

  return cachedStoredThreadsPromise;
}

async function findStoredProjectThreadId(command) {
  const projectId = normalizeThreadLookupValue(command?.projectId || command?.threadId);
  const projectLabel = normalizeThreadLookupValue(command?.projectLabel || command?.threadLabel);

  if (!projectId && !projectLabel) {
    return "";
  }

  const threads = await fetchStoredThreads();
  const candidates = threads
    .filter((thread) => isRealThreadId(thread?.id))
    .filter((thread) => {
      const category = normalizeThreadLookupValue(thread?.category);
      const displayLabel = normalizeThreadLookupValue(thread?.displayLabel);
      const label = normalizeThreadLookupValue(thread?.label);

      return (
        (projectId && (category === projectId || displayLabel.startsWith(`${projectId} /`) || label === projectId))
        || (projectLabel && (category === projectLabel || displayLabel.startsWith(`${projectLabel} /`) || label === projectLabel))
      );
    })
    .sort((left, right) =>
      Number(right?.updatedAt || right?.createdAt || 0) - Number(left?.updatedAt || left?.createdAt || 0)
    );

  return String(candidates[0]?.id || "").trim();
}

async function getResolvedExecutionThread(command, legacyLinksThreadId = "") {
  const sourceThreadId = String(command?.threadId || "").trim();
  const sourceThreadLabel = String(command?.threadLabel || "").trim();
  const fallbackThreadId = String(command?.fallbackThreadId || "").trim();
  const fallbackThreadLabel = String(command?.fallbackThreadLabel || "").trim();
  let threadId = sourceThreadId;
  let threadLabel = sourceThreadLabel;

  if (!isRealThreadId(threadId) && isRealThreadId(fallbackThreadId)) {
    threadId = fallbackThreadId;
    threadLabel = fallbackThreadLabel || threadLabel;
  }

  if (!isRealThreadId(threadId)) {
    if (
      threadId.toLowerCase() === "links"
      || threadLabel.toLowerCase() === "links"
    ) {
      threadId = legacyLinksThreadId || "";
    } else {
      threadId = await findStoredProjectThreadId(command);
    }
  }

  return {
    executionThreadId: threadId,
    executionThreadLabel: threadLabel,
    sourceThreadId,
    sourceThreadLabel
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithProgressHeartbeat(commandId, progressStage, task) {
  if (!commandId) {
    return task()
  }

  let stopped = false
  let timer = null

  const tick = async () => {
    if (stopped) {
      return
    }

    try {
      await updateProgress(commandId, progressStage)
    } finally {
      if (!stopped) {
        timer = setTimeout(tick, TURN_PROGRESS_HEARTBEAT_MS)
        timer.unref?.()
      }
    }
  }

  timer = setTimeout(tick, TURN_PROGRESS_HEARTBEAT_MS)
  timer.unref?.()

  try {
    return await task()
  } finally {
    stopped = true
    if (timer) {
      clearTimeout(timer)
    }
  }
}

async function fetchWithTimeout(resource, init = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  return fetch(resource, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs)
  });
}

function isRetryableFetchError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /fetch failed|ECONNRESET|ETIMEDOUT|timeout|aborted/i.test(message);
}

async function fetchWithRetry(resource, init = {}, timeoutMs = FETCH_TIMEOUT_MS, context = "fetch") {
  let lastError = null;

  for (let attempt = 1; attempt <= FETCH_RETRY_LIMIT; attempt += 1) {
    try {
      return await fetchWithTimeout(resource, init, timeoutMs);
    } catch (error) {
      lastError = error;
      await appendBridgeErrorLog(context, error, { attempt, url: String(resource || "") });

      if (attempt >= FETCH_RETRY_LIMIT || !isRetryableFetchError(error)) {
        throw error;
      }

      await sleep(FETCH_RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError || new Error(`${context} failed`);
}

async function getLegacyLinksThreadId() {
  try {
    const toml = await readFile(`${process.env.HOME}/.codex/automations/links-inbox/automation.toml`, "utf8");
    const match = toml.match(/^target_thread_id = "([^"]+)"/m);

    if (match?.[1]) {
      return match[1];
    }
  } catch (error) {
    await appendBridgeErrorLog("getLegacyLinksThreadId.readAutomationToml", error);
  }

  try {
    return await withCodexAppServer(async ({ request }) => {
      let cursor = null;
      let best = null;

      while (true) {
        const result = await request("thread/list", {
          limit: 100,
          archived: false,
          sourceKinds: ["vscode", "cli"],
          cursor
        });

        for (const row of result?.data || []) {
          const id = String(row?.id || "").trim();
          const cwd = String(row?.cwd || "").trim();
          const title = String(row?.name || row?.preview || "").trim();
          const updatedAt = Number(row?.updatedAt || row?.createdAt || 0);

          if (!id || !isRealThreadId(id)) {
            continue;
          }

          if (cwd !== LINKS_REPO_CWD) {
            continue;
          }

          if (/^(automation:|task:|autonomous task:|system role|system goal|continue$)/i.test(title)) {
            continue;
          }

          if (!best || updatedAt > best.updatedAt) {
            best = { id, updatedAt };
          }
        }

        if (!result?.nextCursor) {
          break;
        }

        cursor = result.nextCursor;
      }

      return best?.id || null;
    });
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
  const sourcePath = join(dir, `${command.id}.${ext}`);

  await mkdir(dir, { recursive: true });
  await writeFile(sourcePath, Buffer.from(base64, "base64"));

  if (canPassImageDirectly(contentType)) {
    return sourcePath;
  }

  const convertedPath = join(dir, `${command.id}.jpg`);

  try {
    await execFileAsync("sips", ["-s", "format", "jpeg", sourcePath, "--out", convertedPath]);
    return convertedPath;
  } catch (error) {
    throw new Error(`Unsupported photo format ${contentType}: ${error.message}`);
  }
}

function isPhotoVisibilityFailure(text) {
  const value = String(text || "").trim().toLowerCase();

  if (!value) {
    return false;
  }

  return [
    "не вижу",
    "не видно",
    "не могу увидеть",
    "не могу прочитать",
    "изображение не видно",
    "изображение недоступно",
    "photo is not visible",
    "image is not visible",
    "image is missing",
    "image is unreadable",
    "can't see the image",
    "cannot see the image",
    "cannot read the image",
    "unable to view the image",
    "unable to read the image"
  ].some((pattern) => value.includes(pattern));
}

function getPhotoUnsupportedReason(value) {
  const text = String(value || "").trim();

  if (!text) {
    return "";
  }

  if (isPhotoVisibilityFailure(text) || /^image unreadable\.?$/i.test(text)) {
    return "Bridge attached the image, but Codex could not read visible image content.";
  }

  if (/unsupported photo format/i.test(text)) {
    return text;
  }

  return "";
}

async function createRetryPhotoVariant(commandId, photoPath) {
  const source = String(photoPath || "").trim();

  if (!source) {
    return null;
  }

  const retryPath = join(tmpdir(), "codex-links-bridge", `${commandId}.retry.jpg`);

  try {
    await execFileAsync("sips", ["-s", "format", "jpeg", "-Z", "2400", source, "--out", retryPath]);
    return retryPath;
  } catch (error) {
    await appendBridgeErrorLog("photoRetryVariant", error, {
      commandId,
      source
    });
    return null;
  }
}

async function extractPhotoOcrText(commandId, photoPath) {
  const source = String(photoPath || "").trim();

  if (!source) {
    return "";
  }

  try {
    const scriptPath = join(process.cwd(), "scripts", "ocr-image.swift");
    const result = await execFileWithOptionsAsync("xcrun", ["swift", scriptPath, source], {
      cwd: process.cwd(),
      timeout: OCR_TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024
    });
    return String(result?.stdout || "").trim().slice(0, 4000);
  } catch (error) {
    await appendBridgeErrorLog("photoOcr", error, {
      commandId,
      source
    });
    return "";
  }
}

function buildBridgeContextFilePaths(command) {
  const workspacePath = String(command?.targetWorkspacePath || "").trim();
  const contextFiles = Array.isArray(command?.targetContextFiles)
    ? command.targetContextFiles.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  if (!workspacePath || !contextFiles.length) {
    return [];
  }

  return contextFiles.map((file) => join(workspacePath, file));
}

function buildBridgePrompt(command, ocrText = "") {
  const userRequest = sanitizeBridgeText(command?.text);
  const projectCategory = String(command?.projectCategory || "").trim() || "other";
  const projectLabel = String(command?.projectLabel || command?.threadLabel || command?.threadId || "").trim() || "links";
  const projectId = String(command?.projectId || command?.threadId || "").trim() || "links";
  const targetRepo = String(command?.targetRepo || "").trim();
  const targetRepoUrl = String(command?.targetRepoUrl || "").trim();
  const workspacePath = String(command?.targetWorkspacePath || "").trim();
  const contextFilePaths = buildBridgeContextFilePaths(command);
  const contextLine = contextFilePaths.length
    ? `Start by reading these project context files in order: ${contextFilePaths.join(" -> ")}.`
    : "Start by reading the selected project context files first.";
  if (command?.photo) {
    return [
      "Codex Links photo task.",
      `Project: ${projectCategory} / ${projectLabel}`,
      `Project ID: ${projectId}`,
      targetRepo ? `Repository: ${targetRepo}` : "",
      targetRepoUrl ? `Repository URL: ${targetRepoUrl}` : "",
      workspacePath ? `Workspace path: ${workspacePath}` : "",
      `Conversation: ${String(command?.threadLabel || command?.threadId || projectLabel).trim()}`,
      `Command ID: ${String(command?.id || "").trim()}`,
      "Inspect the attached image first.",
      "Answer from visible evidence in the image only.",
      ocrText
        ? "OCR helper text is included below. Use it only as a hint and verify it against the visible image."
        : "",
      "Start with one short sentence beginning with 'Observed:' that describes the key visible UI element or text.",
      "Then answer the user's question in Russian in at most 4 short sentences.",
      "Only say the image is missing or unreadable if it is truly not visible to you.",
      ocrText ? "" : "",
      ocrText ? "OCR hint:" : "",
      ocrText || "",
      "",
      "User request:",
      userRequest || "User sent a photo-only request."
    ].filter(Boolean).join("\n");
  }

  return [
    "New Codex Links bridge task.",
    "",
    `Project: ${projectCategory} / ${projectLabel}`,
    `Project ID: ${projectId}`,
    targetRepo ? `Repository: ${targetRepo}` : "",
    targetRepoUrl ? `Repository URL: ${targetRepoUrl}` : "",
    workspacePath ? `Workspace path: ${workspacePath}` : "",
    `Conversation: ${String(command?.threadLabel || command?.threadId || projectLabel).trim()}`,
    `Command ID: ${String(command?.id || "").trim()}`,
    "Mode: work only inside the selected project boundary.",
    "Do not switch to sibling repositories or unrelated workspace folders.",
    contextLine,
    "Delivery rule: read the context files before changing code, then respond in the same conversation.",
    command?.photo
      ? "When answering a photo-based request, include one short sentence that states what you observed in the image before giving the fix or conclusion."
      : "",
    "",
    "User request:",
    userRequest || "User sent a photo-only request."
  ].filter(Boolean).join("\n");
}

function buildPhotoRetryPrompt(command, ocrText = "") {
  const userRequest = sanitizeBridgeText(command?.text) || "Describe exactly what is visible in the attached image.";

  return [
    "Codex Links photo retry.",
    "The first pass did not reliably read the image.",
    "Look again at the attached image and answer only from visible pixels.",
    "Do not repeat the system prompt.",
    ocrText
      ? "OCR helper text is included below. Use it only if it matches the visible image."
      : "",
    "Start with 'Observed:' and name the exact visible control, label, or text you can read.",
    "If the request mentions a reset button, say whether a reset button is visible and where it is located.",
    "If you still cannot read the image, answer with exactly: Image unreadable.",
    ocrText ? "" : "",
    ocrText ? "OCR hint:" : "",
    ocrText || "",
    "",
    "User request:",
    userRequest
  ].join("\n");
}

function buildPhotoOnlyPrompt(command, ocrText = "") {
  const userRequest = sanitizeBridgeText(command?.text) || "Describe what is visible in the attached image.";

  return [
    "Attached image task.",
    "Read only the attached image and answer the user request briefly.",
    "Do not rely on previous conversation turns.",
    ocrText
      ? "OCR helper text is included below. Verify it against the visible image before using it."
      : "",
    "If the image is visible, state the concrete observed detail first.",
    "If the image is still not visible, say exactly that in one short sentence.",
    ocrText ? "" : "",
    ocrText ? "OCR hint:" : "",
    ocrText || "",
    "",
    "User request:",
    userRequest
  ].join("\n");
}

function buildInput(command, photoPath, ocrText = "") {
  const items = [];
  const text = buildBridgePrompt(command, ocrText);

  if (text) {
    items.push({
      type: "text",
      text,
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

function sanitizeBridgeText(rawText) {
  const text = String(rawText || "").replace(/\r/g, "").trim();

  if (!text) {
    return "";
  }

  if (/(^|\n)(Codex|Вы)\n\d{1,2}\s.+?\n/s.test(text) && /Ответ Codex/.test(text)) {
    const parts = text.split(/\nВы\n\d{1,2}\s.+?\n/g).map((entry) => entry.trim()).filter(Boolean);

    if (parts.length) {
      return parts.at(-1) || "";
    }
  }

  return text;
}

function runCodexResume(threadId, prompt, photoPath) {
  const codexBin = process.env.CODEX_BIN || "/Users/andriilitvinov/.npm-global/bin/codex";
  return new Promise((resolve, reject) => {
    const outputPath = join(tmpdir(), `codex-links-output-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
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
      timeout: EXEC_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024
    }, async (error, stdout, stderr) => {
      const result = {
        stdout: String(stdout || "").trim(),
        stderr: String(stderr || "").trim(),
        output: ""
      };

      try {
        result.output = String(await readFile(outputPath, "utf8") || "").trim();
      } catch (error) {
        await appendBridgeErrorLog("runCodexResume.readOutput", error, { outputPath });
      }

      if (error) {
        reject(new Error(result.stderr || result.stdout || error.message));
        return;
      }

      resolve(result);
    });
  });
}

function runCodexExecEphemeral(prompt, photoPath, cwd, timeoutMs = EXEC_TIMEOUT_MS) {
  const codexBin = process.env.CODEX_BIN || "/Users/andriilitvinov/.npm-global/bin/codex";
  return new Promise((resolve, reject) => {
    const outputPath = join(tmpdir(), `codex-links-output-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
    const args = [
      "exec",
      prompt,
      "--ephemeral",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "-c",
      'service_tier="fast"',
      "-o",
      outputPath
    ];

    if (cwd) {
      args.push("-C", cwd);
    }

    if (photoPath) {
      args.push("-i", photoPath);
    }

    execFile(codexBin, args, {
      cwd: cwd || process.cwd(),
      timeout: timeoutMs,
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

async function waitForTurnCompletion(request, threadId, turnId, timeoutMs = EXEC_TIMEOUT_MS, options = {}) {
  const startedAt = Date.now();
  let lastHeartbeatAt = 0;

  while (Date.now() - startedAt < timeoutMs) {
    if (typeof options.onHeartbeat === "function" && Date.now() - lastHeartbeatAt >= TURN_PROGRESS_HEARTBEAT_MS) {
      lastHeartbeatAt = Date.now();
      await options.onHeartbeat();
    }

    const response = await request("thread/read", {
      threadId,
      includeTurns: true
    });
    const turns = Array.isArray(response?.thread?.turns) ? response.thread.turns : [];
    const turn = turns.find((entry) => String(entry?.id || "").trim() === turnId);

    if (turn) {
      const status = String(turn?.status || "").trim().toLowerCase();

      if (status === "completed" || status === "interrupted") {
        return turn;
      }

      if (status === "errored" || status === "failed") {
        throw new Error(`Turn ${turnId} finished with status ${status}.`);
      }
    }

    await sleep(1200);
  }

  throw new Error(`Timed out waiting for turn ${turnId} in thread ${threadId}.`);
}

async function fetchRecentCommands() {
  const response = await fetchWithRetry(getPendingUrl(), {
    headers: {
      accept: "application/json"
    }
  }, FETCH_TIMEOUT_MS, "fetchRecentCommands");

  if (!response.ok) {
    throw new Error(`Failed to load pending commands: ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data.commands) ? data.commands : [];
}

async function claimNextCommand() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetchWithRetry(new URL("/api/commands", baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-write-token": token
      },
      body: JSON.stringify({
        action: "claim",
        processorId: "launchd-bridge",
        leaseMs: CLAIM_LEASE_MS
      })
    }, FETCH_TIMEOUT_MS, "claimNextCommand");

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to claim command: ${response.status} ${body}`);
    }

    const data = await response.json();

    if (data.command) {
      return data.command;
    }

    const queuedLocalCount = Number(data?.claimDiagnostics?.queuedLocalCount || 0);
    const processingLocalCount = Number(data?.claimDiagnostics?.processingLocalCount || 0);

    if (queuedLocalCount > 0) {
      await appendBridgeErrorLog("claimNextCommand.nullWithQueued", new Error("Claim returned null while queued local commands exist."), {
        attempt,
        queuedLocalCount,
        processingLocalCount,
        queuedLocalIds: Array.isArray(data?.claimDiagnostics?.queuedLocalIds) ? data.claimDiagnostics.queuedLocalIds.join(",") : "",
        processingLocalIds: Array.isArray(data?.claimDiagnostics?.processingLocalIds) ? data.claimDiagnostics.processingLocalIds.join(",") : ""
      });
      await sleep(350);
      continue;
    }

    return null;
  }

  return null;
}

async function updateProgress(commandId, progressStage, extras = {}) {
  if (!commandId || !progressStage) {
    return;
  }

  const processingLeaseUntil = new Date(Date.now() + LEASE_EXTENSION_MS).toISOString();
  const response = await fetchWithRetry(new URL("/api/commands", baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-write-token": token
    },
    body: JSON.stringify({
      action: "progress",
      id: commandId,
      progressStage,
      progressUpdatedAt: new Date().toISOString(),
      processingLeaseUntil,
      ...extras
    })
  }, FETCH_TIMEOUT_MS, "updateProgress");

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to update command progress: ${response.status} ${body}`);
  }
}

async function acknowledge(ids) {
  if (!ids.length) {
    return;
  }

  const response = await fetchWithRetry(new URL("/api/commands", baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-write-token": token
    },
    body: JSON.stringify({
      action: "ack",
      ids
    })
  }, FETCH_TIMEOUT_MS, "acknowledge");

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to ack commands: ${response.status} ${body}`);
  }
}

async function markAnswered(commandId, assistantText, completedAt) {
  if (!commandId) {
    return;
  }

  const response = await fetchWithTimeout(new URL("/api/commands", baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-write-token": token
    },
    body: JSON.stringify({
      action: "answer",
      id: commandId,
      progressStage: "answered",
      completedAt,
      actualDispatchMode: "bridge",
      resultAt: completedAt
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to mark command answered: ${response.status} ${body}`);
  }
}

async function markFailed(commandId, errorMessage, completedAt) {
  if (!commandId) {
    return;
  }

  const response = await fetchWithTimeout(new URL("/api/commands", baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-write-token": token
    },
    body: JSON.stringify({
      action: "fail",
      id: commandId,
      progressStage: "failed",
      completedAt,
      actualDispatchMode: "bridge",
      errorMessage,
      resultAt: completedAt
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to mark command failed: ${response.status} ${body}`);
  }
}

async function syncMessages(messages) {
  if (!messages.length) {
    return;
  }

  const response = await fetchWithRetry(getMessagesUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-write-token": token
    },
    body: JSON.stringify({ messages })
  }, FETCH_TIMEOUT_MS, "syncMessages");

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to sync messages: ${response.status} ${body}`);
  }
}

async function publishBridgeStatus(status) {
  const response = await fetchWithRetry(getStatusUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-write-token": token
    },
    body: JSON.stringify({ status })
  }, FETCH_TIMEOUT_MS, "publishBridgeStatus");

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

function stripPromptEcho(text, prompt = "") {
  const value = String(text || "").trim();
  const promptText = String(prompt || "").trim();

  if (!value) {
    return "";
  }

  if (promptText) {
    if (value === promptText) {
      return "";
    }

    if (value.startsWith(promptText)) {
      return value.slice(promptText.length).trim();
    }
  }

  if (
    value.startsWith("New Codex Links bridge task.")
    || value.startsWith("Codex Links photo task.")
    || value.startsWith("Codex Links photo retry.")
  ) {
    return "";
  }

  return value;
}

function getImmediateAssistantText(result, prompt = "") {
  const output = stripPromptEcho(result?.output, prompt);

  if (output) {
    return output;
  }

  const stdout = stripPromptEcho(result?.stdout, prompt);

  if (!stdout) {
    return "";
  }

  return stdout;
}

function extractTurnText(item) {
  if (!item || typeof item !== "object") {
    return "";
  }

  if (typeof item.text === "string" && item.text.trim()) {
    return item.text.trim();
  }

  if (Array.isArray(item.content)) {
    return item.content
      .map((entry) => String(entry?.text || "").trim())
      .filter(Boolean)
      .join("\n\n");
  }

  return "";
}

function findTurnForCommand(turns, command) {
  const commandText = String(command?.text || "").trim();
  const normalizedCommandText = commandText.replace(/\s+/g, " ").trim();

  if (!normalizedCommandText) {
    return null;
  }

  const reversed = [...turns].reverse();

  return reversed.find((turn) => {
    const items = Array.isArray(turn?.items) ? turn.items : [];

    return items.some((item) => {
      if (item?.type !== "userMessage") {
        return false;
      }

      const turnText = extractTurnText(item).replace(/\s+/g, " ").trim();
      return turnText === normalizedCommandText || turnText.includes(normalizedCommandText);
    });
  }) || null;
}

function getTurnAgentMessages(turn) {
  const items = Array.isArray(turn?.items) ? turn.items : [];

  return items
    .filter((item) => item?.type === "agentMessage")
    .map((item) => ({
      text: String(item?.text || "").trim(),
      phase: String(item?.phase || "").trim().toLowerCase()
    }))
    .filter((item) => item.text);
}

function getAssistantTextFromTurn(turn) {
  const status = String(turn?.status || "").trim().toLowerCase();
  const agentMessages = getTurnAgentMessages(turn);
  const finalMessage = [...agentMessages].reverse().find((entry) => entry.phase !== "commentary")?.text || "";
  const lastMessage = agentMessages.at(-1)?.text || "";

  if (finalMessage) {
    return finalMessage;
  }

  if (lastMessage) {
    if (status === "interrupted") {
      return `Codex начал выполнять задачу, но ответ был прерван до финального сообщения.\n\nПоследнее состояние:\n${lastMessage}`;
    }

    return lastMessage;
  }

  return "";
}

async function runTurnStart(threadId, input, options = {}) {
  return withCodexAppServer(async ({ request }) => {
    const started = await request("turn/start", {
      threadId,
      input
    });
    const turnId = String(started?.turn?.id || "").trim();

    if (!turnId) {
      throw new Error("turn/start did not return turn id.");
    }

    return waitForTurnCompletion(request, threadId, turnId, EXEC_TIMEOUT_MS, options);
  });
}

async function getThreadFallbackAssistantText(command, threadId) {
  return withCodexAppServer(async ({ request }) => {
    const response = await request("thread/read", {
      threadId,
      includeTurns: true
    });
    const turns = Array.isArray(response?.thread?.turns) ? response.thread.turns : [];
    const turn = findTurnForCommand(turns, command);

    if (!turn) {
      return "";
    }

    const status = String(turn?.status || "").trim().toLowerCase();
    const text = getAssistantTextFromTurn(turn);
    return text || (status === "interrupted" ? "" : "");
  });
}

function createAssistantMessage(command, threadId, threadLabel, text, createdAt = new Date().toISOString()) {
  const commandId = String(command?.id || "").trim();

  return {
    id: commandId ? `assistant:${commandId}` : createMessageId(threadId, createdAt, text),
    clientId: command.clientId,
    commandId,
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

const initialCommands = await fetchRecentCommands();
const initialQueued = initialCommands
  .filter((command) => command?.status === "queued")
  .sort((left, right) => String(left?.createdAt || "").localeCompare(String(right?.createdAt || "")));
const initialProcessing = initialCommands
  .filter((command) => command?.status === "processing")
  .sort((left, right) => String(left?.createdAt || "").localeCompare(String(right?.createdAt || "")));

const completed = [];
const failed = [];
const syncedMessages = [];

async function flushCompletedBatch(batchCompleted, batchMessages) {
  if (!batchCompleted.length && !batchMessages.length) {
    return;
  }

  if (!batchMessages.length) {
    for (const command of batchCompleted) {
      if (command.result === "failed") {
        await markFailed(command.id, command.errorMessage, command.completedAt);
        continue;
      }

      await markAnswered(command.id, command.assistantText, command.completedAt);
    }
    return;
  }

  try {
    await syncMessages(batchMessages);
  } catch (error) {
    console.error(`Bridge message sync failed after finalization: ${error instanceof Error ? error.message : String(error)}`);
    for (const command of batchCompleted) {
      await markFailed(command.id, "Bridge timed out while saving the assistant reply.", command.completedAt);
    }
    return;
  }

  for (const command of batchCompleted) {
    if (command.result === "failed") {
      await markFailed(command.id, command.errorMessage, command.completedAt);
      continue;
    }

    await markAnswered(command.id, command.assistantText, command.completedAt);
  }
}

const legacyLinksThreadId = await getLegacyLinksThreadId();
let idleDrainUntil = Date.now() + IDLE_DRAIN_WINDOW_MS;

await publishBridgeStatus({
  bridgeOnline: true,
  state: "running",
  lastRunAt: new Date().toISOString(),
  pendingCount: initialQueued.length + initialProcessing.length,
  oldestPendingAt: initialQueued[0]?.createdAt || initialProcessing[0]?.createdAt || "",
  lastDeliveredCount: 0,
  lastError: ""
});

while (true) {
  const command = await claimNextCommand();

  if (!command) {
    if (Date.now() >= idleDrainUntil) {
      break;
    }

    await sleep(IDLE_DRAIN_POLL_MS);
    continue;
  }

  idleDrainUntil = Date.now() + IDLE_DRAIN_WINDOW_MS;

  try {
    await updateProgress(command.id, "claimed", command.photo
      ? {
          photoAttached: true,
          photoBytesPresent: Boolean(command.photo.hasDataUrl || command.photo.dataUrl),
          photoSeenByBridge: true
        }
      : {});

    const {
      executionThreadId,
      sourceThreadId,
      sourceThreadLabel
    } = await getResolvedExecutionThread(command, legacyLinksThreadId);
    let threadId = executionThreadId;

    if (!threadId) {
      throw new Error("Missing threadId.");
    }

    await updateProgress(command.id, "preparing-input");
    const photoPath = await materializePhoto(command);
    const photoOcrText = photoPath ? await extractPhotoOcrText(command.id, photoPath) : "";
    const input = buildInput(command, photoPath, photoOcrText);

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

    await updateProgress(command.id, "sending-to-codex", photoPath
      ? {
          photoAttached: true,
          photoBytesPresent: true,
          photoSeenByBridge: true,
          photoProcessed: true
        }
      : {});
    let assistantText = "";

    try {
      if (photoPath) {
        const result = await runWithProgressHeartbeat(command.id, "waiting-for-codex", () =>
          runCodexExecEphemeral(
            prompt || "See attached image and respond.",
            photoPath,
            String(command?.targetWorkspacePath || "").trim() || process.cwd()
          )
        );
        assistantText = getImmediateAssistantText(result, prompt);

        if (isPhotoVisibilityFailure(assistantText)) {
          await updateProgress(command.id, "retrying-photo-read");
          const retryPhotoPath = await createRetryPhotoVariant(command.id, photoPath);
          const retryPrompt = buildPhotoRetryPrompt(command, photoOcrText);
          const retryResult = await runWithProgressHeartbeat(command.id, "waiting-for-codex", () =>
            runCodexExecEphemeral(
              retryPrompt,
              retryPhotoPath || photoPath,
              String(command?.targetWorkspacePath || "").trim() || process.cwd()
            )
          );
          assistantText = getImmediateAssistantText(retryResult, retryPrompt) || assistantText;
        }
      } else {
        const turn = await runWithProgressHeartbeat(command.id, "waiting-for-codex", () =>
          runTurnStart(threadId, input, {
            onHeartbeat: async () => {
              await updateProgress(command.id, "waiting-for-codex");
            }
          })
        );
        assistantText = getAssistantTextFromTurn(turn);
      }
    } catch (appServerError) {
      if (photoPath) {
        await appendBridgeErrorLog("photoEphemeralRetry", appServerError, {
          commandId: command.id
        });
        const retryPhotoPath = await createRetryPhotoVariant(command.id, photoPath);
        const result = await runWithProgressHeartbeat(command.id, "waiting-for-codex", () =>
          runCodexExecEphemeral(
            buildPhotoRetryPrompt(command, photoOcrText),
            retryPhotoPath || photoPath,
            String(command?.targetWorkspacePath || "").trim() || process.cwd()
          )
        );
        assistantText = getImmediateAssistantText(result, buildPhotoRetryPrompt(command, photoOcrText));
      } else {
        const result = await runWithProgressHeartbeat(command.id, "waiting-for-codex", () =>
          runCodexResume(threadId, prompt || "See attached image and respond.", photoPath)
        );
        assistantText = getImmediateAssistantText(result, prompt);
      }
    }

    const ackedAt = new Date().toISOString();

    if (!assistantText && photoPath) {
      await updateProgress(command.id, "retrying-photo-read");
      const retryPhotoPath = await createRetryPhotoVariant(command.id, photoPath);
      const result = await runWithProgressHeartbeat(command.id, "waiting-for-codex", () =>
        runCodexExecEphemeral(
          buildPhotoOnlyPrompt(command, photoOcrText),
          retryPhotoPath || photoPath,
          String(command?.targetWorkspacePath || "").trim() || process.cwd()
        )
      );
      assistantText = getImmediateAssistantText(result);
    }

    if (!assistantText && !photoPath) {
      await updateProgress(command.id, "reading-codex-reply");
      assistantText = await getThreadFallbackAssistantText(command, threadId);
    }

    assistantText = stripPromptEcho(assistantText, prompt);

    const photoUnsupportedReason = photoPath ? getPhotoUnsupportedReason(assistantText) : "";

    if (photoUnsupportedReason) {
      await updateProgress(command.id, "failed", {
        photoAttached: true,
        photoBytesPresent: true,
        photoSeenByBridge: true,
        photoProcessed: false,
        photoUnsupportedReason,
        lastDiagnosticCode: "bridge_photo_unreadable",
        lastDiagnosticDetail: photoUnsupportedReason
      });
      throw new Error(photoUnsupportedReason);
    }

    if (!assistantText) {
      throw new Error(
        photoPath
          ? "Bridge photo executor did not return a final answer text."
          : "Codex did not return a final answer text."
      );
    }

    await updateProgress(command.id, "saving-reply");

    const deliveryThreadId = sourceThreadId || threadId;
    const deliveryThreadLabel = sourceThreadLabel || command.threadLabel || deliveryThreadId;

    const completedEntry = {
      id: command.id,
      threadId: deliveryThreadId,
      threadLabel: deliveryThreadLabel,
      completedAt: ackedAt,
      assistantText,
      result: "answered"
    };
    const syncedMessage = createAssistantMessage(command, deliveryThreadId, deliveryThreadLabel, assistantText, ackedAt);

    completed.push(completedEntry);
    syncedMessages.push(syncedMessage);
    await flushCompletedBatch([completedEntry], [syncedMessage]);
    idleDrainUntil = Date.now() + IDLE_DRAIN_WINDOW_MS;
  } catch (error) {
    await appendBridgeErrorLog("bridgeCommandFailure", error, { commandId: command?.id || "" });
    const photoUnsupportedReason = command?.photo ? getPhotoUnsupportedReason(error?.message || "") : "";

    if (photoUnsupportedReason) {
      try {
        await updateProgress(command.id, "failed", {
          photoAttached: true,
          photoBytesPresent: Boolean(command.photo?.hasDataUrl || command.photo?.dataUrl || command.photoBytesPresent),
          photoSeenByBridge: true,
          photoProcessed: false,
          photoUnsupportedReason,
          lastDiagnosticCode: "bridge_photo_unreadable",
          lastDiagnosticDetail: photoUnsupportedReason
        });
      } catch {}
    }

    const ackedAt = new Date().toISOString();
    const threadId = (await getResolvedExecutionThread(command, legacyLinksThreadId)).executionThreadId
      || String(command?.threadId || "").trim()
      || legacyLinksThreadId
      || "";
    const threadLabel = String(command?.threadLabel || "").trim() || threadId;
    let assistantText = "";

    if (threadId) {
      try {
        assistantText = await getThreadFallbackAssistantText(command, threadId);
      } catch (error) {
        await appendBridgeErrorLog("bridgeCommandFailure.threadFallback", error, {
          commandId: command?.id || "",
          threadId
        });
      }
    }

    const completedEntry = {
      id: command.id,
      threadId,
      threadLabel,
      completedAt: ackedAt,
      assistantText: assistantText || getFailureAssistantText(error),
      errorMessage: error.message || getFailureAssistantText(error),
      result: assistantText ? "answered" : "failed"
    };
    const syncedMessage = createAssistantMessage(
      command,
      threadId,
      threadLabel,
      completedEntry.assistantText,
      ackedAt
    );

    completed.push(completedEntry);
    syncedMessages.push(syncedMessage);
    await flushCompletedBatch([completedEntry], [syncedMessage]);
    idleDrainUntil = Date.now() + IDLE_DRAIN_WINDOW_MS;
    failed.push({
      id: command.id,
      error: error.message
    });
  }
}

const remainingCommands = await fetchRecentCommands();
const remainingQueued = remainingCommands
  .filter((command) => command?.status === "queued")
  .sort((left, right) => String(left?.createdAt || "").localeCompare(String(right?.createdAt || "")));
const remainingProcessing = remainingCommands
  .filter((command) => command?.status === "processing")
  .sort((left, right) => String(left?.createdAt || "").localeCompare(String(right?.createdAt || "")));

await publishBridgeStatus({
  bridgeOnline: true,
  state: failed.length ? "degraded" : "idle",
  lastRunAt: new Date().toISOString(),
  lastSuccessAt: failed.length ? "" : new Date().toISOString(),
  pendingCount: remainingQueued.length + remainingProcessing.length,
  oldestPendingAt: remainingQueued[0]?.createdAt || remainingProcessing[0]?.createdAt || "",
  lastDeliveredCount: completed.length,
  lastError: failed[0]?.error || ""
});

console.log(JSON.stringify({
  ok: failed.length === 0,
  delivered: completed.length,
  failed
}, null, 2));

clearTimeout(bridgeRunWatchdog);

if (failed.length) {
  process.exit(1);
}
