import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { withCodexAppServer } from "./codex-app-rpc.mjs";
import { resolveClaudeBin, validateClaudeCli } from "./_lib/claude-cli.mjs";
import { BRIDGE_EXEC_TIMEOUT_MS, getBridgeExecTimeoutMs } from "./_lib/bridge-exec-timeouts.mjs";
import {
  buildBridgePrompt,
  buildPhotoOnlyPrompt,
  buildPhotoRetryPrompt,
  selectPrimaryBridgePrompt
} from "./_lib/bridge-prompts.mjs";

const baseUrl = process.env.LINKS_BASE_URL || "https://codex-links.pages.dev";
const token = process.env.LINKS_WRITE_TOKEN;
const BRIDGE_DISPATCH_MODE = process.env.BRIDGE_DISPATCH_MODE || "local-bridge";
const BRIDGE_EXECUTOR = (process.env.BRIDGE_EXECUTOR || "codex").trim().toLowerCase() === "claude" ? "claude" : "codex";
const BRIDGE_CODEX_NEW_THREAD_PER_COMMAND = String(process.env.BRIDGE_CODEX_NEW_THREAD_PER_COMMAND || "1").trim() !== "0";
const PROCESSOR_ID = String(process.env.BRIDGE_PROCESSOR_ID || "").trim()
  || `launchd-${BRIDGE_EXECUTOR}-bridge:${hostname()}:${process.pid}`;
const CLAIM_LEASE_MS = 5 * 60 * 1000;
const READ_TIMEOUT_MS = 15 * 1000;
const WRITE_TIMEOUT_MS = 60 * 1000;
const SNAPSHOT_TIMEOUT_MS = 12 * 1000;
const BRIDGE_RUN_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const LEASE_EXTENSION_MS = 5 * 60 * 1000;
const TURN_PROGRESS_HEARTBEAT_MS = 15 * 1000;
const BRIDGE_STATUS_HEARTBEAT_MS = 30 * 1000;
const MAINTENANCE_INTERVAL_MS = 60 * 1000;
const IDLE_DRAIN_WINDOW_MS = 15 * 60 * 1000;
const IDLE_DRAIN_POLL_MS = 1500;
const MAX_IN_FLIGHT_BRIDGE_TASKS = 2;
const PHOTO_PREP_TIMEOUT_MS = 60 * 1000;
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

await runClaudeBridgePreflight();

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

function getRecentMessagesUrl() {
  const url = new URL("/api/messages", baseUrl);
  url.searchParams.set("scope", "recent");
  url.searchParams.set("token", token);
  return url.toString();
}

function getStatusUrl() {
  return new URL("/api/status", baseUrl).toString();
}

function getMaintenanceUrl() {
  return new URL("/api/admin/commands-maintenance", baseUrl).toString();
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

function spawnFileWithOutput(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const stdinInput = Object.prototype.hasOwnProperty.call(options, "stdin")
      ? String(options.stdin || "")
      : null;
    const child = spawn(file, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      stdio: [stdinInput === null ? "ignore" : "pipe", "pipe", "pipe"]
    });
    const maxBuffer = Number(options.maxBuffer || 10 * 1024 * 1024);
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeoutMs = Number(options.timeout || 0);
    const timer = timeoutMs > 0
      ? setTimeout(() => {
          if (settled) {
            return;
          }
          child.kill("SIGTERM");
        }, timeoutMs)
      : null;

    const finish = (callback) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      callback();
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length + stderr.length > maxBuffer) {
        child.kill("SIGTERM");
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stdout.length + stderr.length > maxBuffer) {
        child.kill("SIGTERM");
      }
    });

    if (stdinInput !== null) {
      child.stdin.end(stdinInput);
    }

    child.on("error", (error) => {
      finish(() => reject(error));
    });

    child.on("close", (code, signal) => {
      finish(() => {
        if (stdout.length + stderr.length > maxBuffer) {
          const error = new Error(`Command exceeded maxBuffer: ${file}`);
          error.code = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
          reject(error);
          return;
        }

        if (code || signal) {
          const error = new Error(signal
            ? `Command was terminated by ${signal}: ${file}`
            : `Command failed with exit code ${code}: ${file}`);
          error.code = code;
          error.signal = signal;
          resolve({ error, stdout, stderr });
          return;
        }

        resolve({ stdout, stderr });
      });
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
        }, READ_TIMEOUT_MS, "fetchStoredThreads");

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

function photoPhaseTimeout(task, options = {}) {
  const timeoutMs = Number(options.timeoutMs || PHOTO_PREP_TIMEOUT_MS);
  const commandId = String(options.commandId || "").trim();
  const phase = String(options.phase || "photo-prep").trim() || "photo-prep";

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      const error = new Error(`photo_wait_timeout:${phase}`);
      error.code = "photo_wait_timeout";
      error.phase = phase;
      error.commandId = commandId;
      void appendBridgeErrorLog("photoPhaseTimeout", error, {
        commandId,
        phase,
        timeoutMs
      });
      reject(error);
    }, timeoutMs);

    timer.unref?.();

    Promise.resolve()
      .then(task)
      .then((value) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        reject(error);
      });
  });
}

function isPhotoWaitTimeoutError(error) {
  return String(error?.code || "").trim() === "photo_wait_timeout"
    || /photo_wait_timeout/i.test(String(error?.message || "").trim());
}

async function runWithProgressHeartbeat(commandId, progressStage, task, processorId = "") {
  if (!commandId) {
    return task();
  }

  let stopped = false;
  let timer = null;
  let activeTick = null;

  const tick = async () => {
    if (stopped) {
      return;
    }

    const currentTick = (async () => {
      try {
        await updateProgress(commandId, progressStage, {}, processorId);
      } catch (error) {
        await appendBridgeErrorLog("runWithProgressHeartbeat.updateProgress", error, {
          commandId,
          progressStage
        });
      }
    })();

    activeTick = currentTick;

    try {
      await currentTick;
    } finally {
      if (activeTick === currentTick) {
        activeTick = null;
      }

      if (!stopped) {
        timer = setTimeout(() => {
          void tick();
        }, TURN_PROGRESS_HEARTBEAT_MS);
        timer.unref?.();
      }
    }
  };

  timer = setTimeout(() => {
    void tick();
  }, TURN_PROGRESS_HEARTBEAT_MS);
  timer.unref?.();

  try {
    return await task();
  } finally {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
    if (activeTick) {
      await activeTick;
    }
  }
}

async function fetchWithTimeout(resource, init = {}, timeoutMs = READ_TIMEOUT_MS) {
  return fetch(resource, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs)
  });
}

function isRetryableFetchError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /fetch failed|ECONNRESET|ETIMEDOUT|timeout|aborted/i.test(message);
}

async function fetchWithRetry(resource, init = {}, timeoutMs = READ_TIMEOUT_MS, context = "fetch") {
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
    if (error?.code !== "ENOENT") {
      await appendBridgeErrorLog("getLegacyLinksThreadId.readAutomationToml", error);
    }
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
    if (isDeveloperToolsUnavailableError(error)) {
      await logBridgeInfo("photoOcr.skipped", {
        commandId,
        reason: "developer-tools-unavailable"
      });
      return "";
    }

    await appendBridgeErrorLog("photoOcr", error, {
      commandId,
      source
    });
    return "";
  }
}

function isDeveloperToolsUnavailableError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("invalid active developer path")
    || message.includes("missing xcrun")
    || message.includes("missing developer_dir path");
}

function normalizePhotoOcrHint(rawText) {
  const text = String(rawText || "").trim();

  if (!text) {
    return "";
  }

  const collapsed = text.replace(/\s+/g, " ").trim();

  if (collapsed.length < 3) {
    return "";
  }

  if (!/[A-Za-z0-9\u0400-\u04FF]/.test(collapsed)) {
    return "";
  }

  return collapsed;
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

function runCodexResume(threadId, prompt, photoPath, timeoutMs = BRIDGE_EXEC_TIMEOUT_MS) {
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
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"]
    }, async (error, stdout, stderr) => {
      const result = {
        stdout: String(stdout || "").trim(),
        stderr: String(stderr || "").trim(),
        output: ""
      };
      let readOutputError = null;

      try {
        result.output = String(await readFile(outputPath, "utf8") || "").trim();
      } catch (error) {
        readOutputError = error;
        await appendBridgeErrorLog("runCodexResume.readOutput", error, { outputPath });
      }

      if (error) {
        if (shouldTreatCodexExecAsUsable(error, result, prompt)) {
          resolve(result);
          return;
        }

        reject(new Error(result.stderr || result.stdout || error.message));
        return;
      }

      if (readOutputError && !getImmediateAssistantText(result, prompt)) {
        reject(new Error("Codex completed without a readable output file."));
        return;
      }

      resolve(result);
    });
  });
}

function runCodexExecEphemeral(prompt, photoPath, cwd, timeoutMs = BRIDGE_EXEC_TIMEOUT_MS) {
  return runCodexExec(prompt, photoPath, cwd, timeoutMs, { ephemeral: true });
}

function runCodexExecFreshThread(prompt, photoPath, cwd, timeoutMs = BRIDGE_EXEC_TIMEOUT_MS) {
  return runCodexExec(prompt, photoPath, cwd, timeoutMs, { ephemeral: false });
}

function runCodexExec(prompt, photoPath, cwd, timeoutMs = BRIDGE_EXEC_TIMEOUT_MS, options = {}) {
  const codexBin = process.env.CODEX_BIN || "/Users/andriilitvinov/.npm-global/bin/codex";
  return new Promise((resolve, reject) => {
    const outputPath = join(tmpdir(), `codex-links-output-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
    const codexArgs = [
      "exec",
      prompt,
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "-c",
      'service_tier="fast"',
      "-o",
      outputPath
    ];

    if (options.ephemeral) {
      codexArgs.splice(2, 0, "--ephemeral");
    }

    if (cwd) {
      codexArgs.push("-C", cwd);
    }

    if (photoPath) {
      codexArgs.push("-i", photoPath);
    }

    spawnFileWithOutput(codexBin, codexArgs, {
      cwd: cwd || process.cwd(),
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024
    }).then(async ({ error, stdout, stderr }) => {
      const result = {
        stdout: String(stdout || "").trim(),
        stderr: String(stderr || "").trim(),
        output: ""
      };

      try {
        result.output = String(await readFile(outputPath, "utf8") || "").trim();
      } catch {}

      if (error) {
        if (shouldTreatCodexExecAsUsable(error, result, prompt)) {
          resolve(result);
          return;
        }

        reject(new Error(result.stderr || result.stdout || error.message));
        return;
      }

      resolve(result);
    }).catch(reject);
  });
}

async function waitForTurnCompletion(request, threadId, turnId, timeoutMs = BRIDGE_EXEC_TIMEOUT_MS, options = {}) {
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
  const response = await fetchWithTimeout(getPendingUrl(), {
    headers: {
      accept: "application/json"
    }
  }, SNAPSHOT_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`Failed to load pending commands: ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data.commands) ? data.commands : [];
}

async function safeFetchRecentCommands(context = "fetchRecentCommands") {
  try {
    return await fetchRecentCommands();
  } catch (error) {
    await appendBridgeErrorLog(context, error);
    return [];
  }
}

async function fetchCommandById(commandId) {
  const normalizedId = String(commandId || "").trim();

  if (!normalizedId) {
    return null;
  }

  const response = await fetchWithRetry(`${baseUrl.replace(/\/$/, "")}/api/commands?id=${encodeURIComponent(normalizedId)}`, {
    headers: {
      accept: "application/json"
    }
  }, READ_TIMEOUT_MS, "fetchCommandById");

  if (!response.ok) {
    throw new Error(`Failed to load command ${normalizedId}: ${response.status}`);
  }

  const data = await response.json().catch(() => ({}));
  return data?.command || null;
}

async function claimNextCommand(options = {}) {
  const textOnly = Boolean(options.textOnly);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetchWithRetry(new URL("/api/commands", baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-write-token": token
      },
      body: JSON.stringify({
        action: "claim",
        processorId: PROCESSOR_ID,
        leaseMs: CLAIM_LEASE_MS,
        dispatchMode: BRIDGE_DISPATCH_MODE,
        textOnly
      })
    }, WRITE_TIMEOUT_MS, "claimNextCommand");

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to claim command: ${response.status} ${body}`);
    }

    const data = await response.json();

    if (data.command) {
      return data.command;
    }

    const queuedRequestedCount = Number(data?.claimDiagnostics?.queuedRequestedCount || 0);
    const processingRequestedCount = Number(data?.claimDiagnostics?.processingRequestedCount || 0);
    const queuedRequestedIds = Array.isArray(data?.claimDiagnostics?.queuedRequestedIds)
      ? data.claimDiagnostics.queuedRequestedIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
    const processingRequestedIds = Array.isArray(data?.claimDiagnostics?.processingRequestedIds)
      ? data.claimDiagnostics.processingRequestedIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [];

    if (queuedRequestedCount > 0) {
      await appendBridgeErrorLog("claimNextCommand.nullWithQueued", new Error("Claim returned null while queued commands exist for the requested dispatch mode."), {
        attempt,
        bridgeDispatchMode: BRIDGE_DISPATCH_MODE,
        textOnly,
        requestedDispatchMode: String(data?.claimDiagnostics?.requestedDispatchMode || "").trim(),
        queuedRequestedCount,
        processingRequestedCount,
        queuedRequestedIds: queuedRequestedIds.join(","),
        processingRequestedIds: processingRequestedIds.join(","),
        oldestQueuedRequestedAt: String(data?.claimDiagnostics?.oldestQueuedRequestedAt || "").trim(),
        oldestQueuedRequestedAgeMs: Number(data?.claimDiagnostics?.oldestQueuedRequestedAgeMs || 0)
      });

      const processingCommandId = processingRequestedIds[0];

      if (processingCommandId) {
        try {
          const processingCommand = await fetchCommandById(processingCommandId);
          const leaseDeadline = Date.parse(String(processingCommand?.processingLeaseUntil || "").trim());

          if (!Number.isNaN(leaseDeadline) && leaseDeadline <= Date.now()) {
            const response = await fetchWithRetry(new URL("/api/commands", baseUrl), {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-write-token": token
              },
              body: JSON.stringify({
                action: "requeue",
                id: processingCommandId
              })
            }, WRITE_TIMEOUT_MS, "claimNextCommand.requeueStaleProcessing");

            if (!response.ok) {
              const body = await response.text();
              throw new Error(`Failed to requeue stale processing command: ${response.status} ${body}`);
            }
          }
        } catch (error) {
          await appendBridgeErrorLog("claimNextCommand.requeueStaleProcessing", error, {
            processingCommandId
          });
        }
      }

      await sleep(350);
      continue;
    }

    return null;
  }

  return null;
}

async function runDeliveryMaintenance() {
  const response = await fetchWithRetry(getMaintenanceUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-write-token": token
    },
    body: JSON.stringify({
      syncReplies: true
    })
  }, WRITE_TIMEOUT_MS, "runDeliveryMaintenance");

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to run delivery maintenance: ${response.status} ${body}`);
  }

  return response.json().catch(() => ({}));
}

async function updateProgress(commandId, progressStage, extras = {}, processorId = "") {
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
      processorId,
      progressStage,
      progressUpdatedAt: new Date().toISOString(),
      processingLeaseUntil,
      ...extras
    })
  }, WRITE_TIMEOUT_MS, "updateProgress");

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
  }, WRITE_TIMEOUT_MS, "acknowledge");

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to ack commands: ${response.status} ${body}`);
  }
}

async function markAnswered(commandId, assistantText, completedAt, processorId = "") {
  if (!commandId) {
    return;
  }

  const response = await fetchWithRetry(new URL("/api/commands", baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-write-token": token
    },
    body: JSON.stringify({
      action: "answer",
      id: commandId,
      processorId,
      progressStage: "answered",
      completedAt,
      actualDispatchMode: BRIDGE_EXECUTOR === "claude" ? "claude" : "bridge",
      resultAt: completedAt
    })
  }, WRITE_TIMEOUT_MS, "markAnswered");

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to mark command answered: ${response.status} ${body}`);
  }

  const data = await response.json().catch(() => ({}));
  return data?.command || null;
}

async function markFailed(commandId, errorMessage, completedAt, processorId = "") {
  if (!commandId) {
    return;
  }

  const response = await fetchWithRetry(new URL("/api/commands", baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-write-token": token
    },
    body: JSON.stringify({
      action: "fail",
      id: commandId,
      processorId,
      progressStage: "failed",
      completedAt,
      actualDispatchMode: BRIDGE_EXECUTOR === "claude" ? "claude" : "bridge",
      errorMessage,
      resultAt: completedAt
    })
  }, WRITE_TIMEOUT_MS, "markFailed");

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to mark command failed: ${response.status} ${body}`);
  }

  const data = await response.json().catch(() => ({}));
  return data?.command || null;
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
  }, WRITE_TIMEOUT_MS, "syncMessages");

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to sync messages: ${response.status} ${body}`);
  }
}

async function readRecentMessages() {
  const response = await fetchWithRetry(getRecentMessagesUrl(), {
    headers: {
      accept: "application/json"
    }
  }, READ_TIMEOUT_MS, "readRecentMessages");

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to read recent messages: ${response.status} ${body}`);
  }

  const data = await response.json().catch(() => ({}));
  return Array.isArray(data?.messages) ? data.messages : [];
}

async function readRecentCommands() {
  const response = await fetchWithRetry(getPendingUrl(), {
    headers: {
      accept: "application/json"
    }
  }, READ_TIMEOUT_MS, "readRecentCommands");

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to read recent commands: ${response.status} ${body}`);
  }

  const data = await response.json().catch(() => ({}));
  return Array.isArray(data?.commands) ? data.commands : [];
}

async function wasMessagePersisted(message) {
  if (!message?.id) {
    return false;
  }

  const recent = await readRecentMessages();
  return recent.some((entry) => String(entry?.id || "").trim() === String(message.id).trim());
}

async function wasCommandAnswered(commandId) {
  if (!commandId) {
    return false;
  }

  const recent = await readRecentCommands();
  return recent.some((entry) =>
    String(entry?.id || "").trim() === String(commandId).trim()
    && String(entry?.status || "").trim().toLowerCase() === "answered"
  );
}

async function isProcessorOwner(commandId, processorId) {
  const normalizedProcessorId = String(processorId || "").trim();

  if (!commandId || !normalizedProcessorId) {
    return false;
  }

  const command = await fetchCommandById(commandId).catch((error) => {
    void appendBridgeErrorLog("isProcessorOwner.fetch", error, { commandId });
    return null;
  });

  return String(command?.status || "").trim().toLowerCase() === "processing"
    && String(command?.processorId || "").trim() === normalizedProcessorId;
}

async function publishBridgeStatus(status) {
  const response = await fetchWithRetry(getStatusUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-write-token": token
    },
    body: JSON.stringify({ status })
  }, WRITE_TIMEOUT_MS, "publishBridgeStatus");

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to publish bridge status: ${response.status} ${body}`);
  }
}

async function runClaudeBridgePreflight() {
  if (BRIDGE_EXECUTOR !== "claude") {
    return null;
  }

  try {
    return await validateClaudeCli({
      env: process.env,
      timeoutMs: WRITE_TIMEOUT_MS
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Claude CLI validation failed.");

    await logBridgeError("Claude bridge preflight failed", error, {
      claudeBin: resolveClaudeBin(process.env)
    });

    await publishBridgeStatus({
      bridgeOnline: false,
      state: "degraded",
      lastRunAt: new Date().toISOString(),
      lastSuccessAt: "",
      pendingCount: 0,
      oldestPendingAt: "",
      lastDeliveredCount: 0,
      lastError: message,
      claudeBridge: {
        online: false,
        state: "degraded",
        lastRunAt: new Date().toISOString(),
        lastSuccessAt: "",
        pendingCount: 0,
        oldestPendingAt: "",
        lastDeliveredCount: 0,
        lastError: message
      }
    });

    throw new Error(message);
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

function isBenignCodexExecErrorMessage(message) {
  const text = String(message || "").trim().toLowerCase();

  if (!text) {
    return false;
  }

  return text.includes("no stdin data received in 3s");
}

function shouldTreatCodexExecAsUsable(error, result, prompt = "") {
  if (!error) {
    return false;
  }

  if (!getImmediateAssistantText(result, prompt)) {
    return false;
  }

  return isBenignCodexExecErrorMessage(error.message)
    || isBenignCodexExecErrorMessage(result?.stderr)
    || isBenignCodexExecErrorMessage(result?.stdout);
}

function runClaudePrint(prompt, photoPath, cwd, timeoutMs = BRIDGE_EXEC_TIMEOUT_MS) {
  const claudeBin = resolveClaudeBin(process.env);
  const instructions = [
    String(prompt || "").trim(),
    photoPath
      ? `Attached local image path: ${photoPath}\nRead that local image file before answering. Base the answer on visible evidence from the image.`
      : ""
  ].filter(Boolean).join("\n\n");
  const addDirArgs = [
    "--add-dir",
    cwd || process.cwd(),
    ...(photoPath ? ["--add-dir", dirname(photoPath)] : [])
  ];

  return new Promise((resolve, reject) => {
    void logBridgeInfo("claudePrint.start", {
      cwd: cwd || process.cwd(),
      timeoutMs,
      photoAttached: Boolean(photoPath),
      promptChars: instructions.length
    });

    spawnFileWithOutput(claudeBin, [
      "-p",
      "--input-format",
      "text",
      "--output-format",
      "text",
      "--permission-mode",
      "bypassPermissions",
      ...addDirArgs
    ], {
      cwd: cwd || process.cwd(),
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env
      },
      stdin: instructions
    }).then(({ error, stdout, stderr }) => {
      const result = {
        output: String(stdout || "").trim(),
        stdout: String(stdout || "").trim(),
        stderr: String(stderr || "").trim()
      };

      if (error) {
        void logBridgeError("claudePrint.error", error, {
          cwd: cwd || process.cwd(),
          timeoutMs,
          photoAttached: Boolean(photoPath),
          stdoutChars: result.stdout.length,
          stderrChars: result.stderr.length
        });
        reject(new Error(String(stderr || error.message || "Claude CLI failed.")));
        return;
      }

      void logBridgeInfo("claudePrint.finish", {
        cwd: cwd || process.cwd(),
        timeoutMs,
        photoAttached: Boolean(photoPath),
        stdoutChars: result.stdout.length,
        stderrChars: result.stderr.length
      });
      resolve(result);
    }).catch(reject);
  });
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

    return waitForTurnCompletion(request, threadId, turnId, Number(options.timeoutMs || BRIDGE_EXEC_TIMEOUT_MS), options);
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
  return {
    id: `assistant-${command.id}`,
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

await runDeliveryMaintenance().catch((error) => {
  void appendBridgeErrorLog("runDeliveryMaintenance.startup", error);
});

const maintenanceTimer = setInterval(() => {
  void runDeliveryMaintenance().catch((error) => {
    void appendBridgeErrorLog("runDeliveryMaintenance.interval", error);
  });
}, MAINTENANCE_INTERVAL_MS);

maintenanceTimer.unref?.();

const initialCommands = await safeFetchRecentCommands("initialRecentCommands");
const initialQueued = initialCommands
  .filter((command) => command?.status === "queued")
  .sort((left, right) => String(left?.createdAt || "").localeCompare(String(right?.createdAt || "")));
const initialProcessing = initialCommands
  .filter((command) => command?.status === "processing")
  .sort((left, right) => String(left?.createdAt || "").localeCompare(String(right?.createdAt || "")));

const completed = [];
const failed = [];
const syncedMessages = [];
const inFlightTasks = new Set();
let textLaneTask = null;
let generalLaneTask = null;

function buildRunnerHeartbeatStatus() {
  const now = new Date().toISOString();
  const runnerState = inFlightTasks.size ? "running" : "idle";

  return {
    bridgeOnline: BRIDGE_EXECUTOR !== "claude",
    ...(BRIDGE_EXECUTOR === "claude"
      ? {
          claudeBridge: {
            online: true,
            state: runnerState,
            lastRunAt: now,
            pendingCount: inFlightTasks.size,
            lastError: ""
          }
        }
      : {
          localBridge: {
            online: true,
            managedBy: "launchd",
            state: runnerState,
            lastRunAt: now,
            pendingCount: inFlightTasks.size,
            lastError: ""
          }
        })
  };
}

async function flushCompletedBatch(batchCompleted, batchMessages) {
  if (!batchCompleted.length && !batchMessages.length) {
    return;
  }

  for (const command of batchCompleted) {
    const message = batchMessages.find((entry) => entry.commandId === command.id) || null;

    if (!(await isProcessorOwner(command.id, command.processorId))) {
      await appendBridgeErrorLog("flushCompletedBatch.skipLostProcessorOwnership", new Error("Skipping completion from a bridge worker that no longer owns the command."), {
        commandId: command.id,
        processorId: command.processorId
      });
      continue;
    }

    if (command.result === "failed") {
      try {
        if (message) {
          await syncMessages([message]);
        }
      } finally {
        await markFailed(command.id, command.errorMessage, command.completedAt, command.processorId);
      }
      continue;
    }

    if (message) {
      try {
        await syncMessages([message]);
      } catch (error) {
        if (!isRetryableFetchError(error) || !(await wasMessagePersisted(message))) {
          throw error;
        }

        await appendBridgeErrorLog("syncMessages.reconciled", error, {
          commandId: command.id,
          messageId: message.id
        });
      }
    }

    try {
      await markAnswered(command.id, command.assistantText, command.completedAt, command.processorId);
    } catch (error) {
      if (!isRetryableFetchError(error) || !(await wasCommandAnswered(command.id))) {
        throw error;
      }

      await appendBridgeErrorLog("markAnswered.reconciled", error, {
        commandId: command.id
      });
    }
  }
}

const legacyLinksThreadId = await getLegacyLinksThreadId();
let idleDrainUntil = Date.now() + IDLE_DRAIN_WINDOW_MS;

await publishBridgeStatus({
  bridgeOnline: BRIDGE_EXECUTOR !== "claude",
  state: "running",
  lastRunAt: new Date().toISOString(),
  pendingCount: initialQueued.length + initialProcessing.length,
  oldestPendingAt: initialQueued[0]?.createdAt || initialProcessing[0]?.createdAt || "",
  lastDeliveredCount: 0,
  lastError: "",
  ...(BRIDGE_EXECUTOR === "claude"
    ? {
        claudeBridge: {
          online: true,
          state: "running",
          lastRunAt: new Date().toISOString(),
          pendingCount: initialQueued.length + initialProcessing.length,
          oldestPendingAt: initialQueued[0]?.createdAt || initialProcessing[0]?.createdAt || "",
          lastDeliveredCount: 0,
          lastError: ""
        }
      }
    : {
        localBridge: {
          online: true,
          managedBy: "launchd",
          state: "running",
          lastRunAt: new Date().toISOString(),
          pendingCount: initialQueued.length + initialProcessing.length,
          oldestPendingAt: initialQueued[0]?.createdAt || initialProcessing[0]?.createdAt || "",
          lastDeliveredCount: 0,
          lastError: ""
        }
      })
});

const heartbeatTimer = setInterval(() => {
  void publishBridgeStatus(buildRunnerHeartbeatStatus()).catch((error) => {
    void appendBridgeErrorLog("publishBridgeStatus.heartbeat", error);
  });
}, BRIDGE_STATUS_HEARTBEAT_MS);

heartbeatTimer.unref?.();

async function processClaimedCommand(command) {
  try {
    await updateProgress(command.id, "claimed", command.photo
      ? {
          photoAttached: true,
          photoBytesPresent: Boolean(command.photo.hasDataUrl || command.photo.dataUrl),
          photoSeenByBridge: true
        }
      : {}, command.processorId);

    const {
      executionThreadId,
      sourceThreadId,
      sourceThreadLabel
    } = await getResolvedExecutionThread(command, legacyLinksThreadId);
    let threadId = executionThreadId;
    const useFreshCodexThread = BRIDGE_EXECUTOR === "codex" && BRIDGE_CODEX_NEW_THREAD_PER_COMMAND && !command.photo;

    if (!threadId && BRIDGE_EXECUTOR !== "claude" && !useFreshCodexThread) {
      throw new Error("Missing threadId.");
    }

    let photoPath = null;
    let photoOcrText = "";

    if (command.photo) {
      await updateProgress(command.id, "waiting-for-photo", {
        photoAttached: true,
        photoBytesPresent: Boolean(command.photo.hasDataUrl || command.photo.dataUrl),
        photoSeenByBridge: true,
        photoProcessed: false,
        lastDiagnosticCode: "bridge_waiting_photo",
        lastDiagnosticDetail: "Bridge is preparing the attached photo for delivery."
      }, command.processorId);

      const photoPrep = await runWithProgressHeartbeat(command.id, "waiting-for-photo", () =>
        photoPhaseTimeout(async () => {
          const preparedPhotoPath = await materializePhoto(command);
          const preparedPhotoOcrText = preparedPhotoPath
            ? normalizePhotoOcrHint(await extractPhotoOcrText(command.id, preparedPhotoPath))
            : "";

          return {
            photoPath: preparedPhotoPath,
            photoOcrText: preparedPhotoOcrText
          };
        }, {
          commandId: command.id,
          phase: "prepare-photo"
        })
      , command.processorId);

      photoPath = photoPrep?.photoPath || null;
      photoOcrText = String(photoPrep?.photoOcrText || "").trim();
    } else {
      await updateProgress(command.id, "preparing-input", {}, command.processorId);
    }

    const input = buildInput(command, photoPath, photoOcrText);

    if (!input.length) {
      throw new Error("Command has no deliverable content.");
    }

    const prompt = input
      .filter((item) => item?.type === "text" && item?.text)
      .map((item) => String(item.text).trim())
      .filter(Boolean)
      .join("\n\n");
    const photoPrompt = photoPath ? selectPrimaryBridgePrompt(command, photoOcrText) : "";

    if (!prompt && !photoPath) {
      throw new Error(`Command ${command.id} has no CLI-deliverable content.`);
    }

    await updateProgress(command.id, "sending-to-codex", photoPath
      ? {
          photoAttached: true,
          photoBytesPresent: true,
          photoSeenByBridge: true,
          photoProcessed: true,
          lastDiagnosticCode: "",
          lastDiagnosticDetail: "",
          photoUnsupportedReason: ""
        }
      : {}, command.processorId);
    let assistantText = "";
    const commandExecTimeoutMs = getBridgeExecTimeoutMs(command);

    try {
      if (photoPath) {
        const result = await runWithProgressHeartbeat(command.id, "waiting-for-codex", () =>
          BRIDGE_EXECUTOR === "claude"
            ? runClaudePrint(
                photoPrompt || "See attached image and respond.",
                photoPath,
                String(command?.targetWorkspacePath || "").trim() || process.cwd(),
                commandExecTimeoutMs
              )
            : runCodexExecEphemeral(
                photoPrompt || "See attached image and respond.",
                photoPath,
                String(command?.targetWorkspacePath || "").trim() || process.cwd()
              )
        , command.processorId);
        assistantText = getImmediateAssistantText(result, photoPrompt);

        if (isPhotoVisibilityFailure(assistantText)) {
          await updateProgress(command.id, "retrying-photo-read", {}, command.processorId);
          const retryPhotoPath = await createRetryPhotoVariant(command.id, photoPath);
          const retryPrompt = buildPhotoRetryPrompt(command, photoOcrText);
          const retryResult = await runWithProgressHeartbeat(command.id, "waiting-for-codex", () =>
            BRIDGE_EXECUTOR === "claude"
              ? runClaudePrint(
                  retryPrompt,
                  retryPhotoPath || photoPath,
                  String(command?.targetWorkspacePath || "").trim() || process.cwd(),
                  commandExecTimeoutMs
                )
              : runCodexExecEphemeral(
                  retryPrompt,
                  retryPhotoPath || photoPath,
                  String(command?.targetWorkspacePath || "").trim() || process.cwd()
                )
          , command.processorId);
          assistantText = getImmediateAssistantText(retryResult, retryPrompt) || assistantText;
        }
      } else {
        if (BRIDGE_EXECUTOR === "claude") {
          const result = await runWithProgressHeartbeat(command.id, "waiting-for-codex", () =>
            runClaudePrint(
              prompt || "Handle the task.",
              "",
              String(command?.targetWorkspacePath || "").trim() || process.cwd()
            )
          , command.processorId);
          assistantText = getImmediateAssistantText(result, prompt);
        } else {
          if (useFreshCodexThread) {
            const result = await runWithProgressHeartbeat(command.id, "waiting-for-codex", () =>
              runCodexExecFreshThread(
                prompt || "Handle the task.",
                "",
                String(command?.targetWorkspacePath || "").trim() || process.cwd(),
                commandExecTimeoutMs
              )
            , command.processorId);
            assistantText = getImmediateAssistantText(result, prompt);
          } else {
            const turn = await runWithProgressHeartbeat(command.id, "waiting-for-codex", () =>
              runTurnStart(threadId, input, {
                timeoutMs: commandExecTimeoutMs,
                onHeartbeat: async () => {
                  await updateProgress(command.id, "waiting-for-codex", {}, command.processorId);
                }
              })
            , command.processorId);
            assistantText = getAssistantTextFromTurn(turn);
          }
        }
      }
    } catch (appServerError) {
      if (photoPath) {
        await appendBridgeErrorLog("photoEphemeralRetry", appServerError, {
          commandId: command.id
        });
        const retryPhotoPath = await createRetryPhotoVariant(command.id, photoPath);
        const result = await runWithProgressHeartbeat(command.id, "waiting-for-codex", () =>
          BRIDGE_EXECUTOR === "claude"
            ? runClaudePrint(
                buildPhotoRetryPrompt(command, photoOcrText),
                retryPhotoPath || photoPath,
                String(command?.targetWorkspacePath || "").trim() || process.cwd(),
                commandExecTimeoutMs
              )
            : runCodexExecEphemeral(
                buildPhotoRetryPrompt(command, photoOcrText),
                retryPhotoPath || photoPath,
                String(command?.targetWorkspacePath || "").trim() || process.cwd()
              )
        , command.processorId);
        assistantText = getImmediateAssistantText(result, buildPhotoRetryPrompt(command, photoOcrText));
      } else {
        const result = await runWithProgressHeartbeat(command.id, "waiting-for-codex", () =>
          BRIDGE_EXECUTOR === "claude"
            ? runClaudePrint(
              prompt || "Handle the task.",
              "",
              String(command?.targetWorkspacePath || "").trim() || process.cwd()
            )
              : useFreshCodexThread
                ? runCodexExecFreshThread(
                    prompt || "Handle the task.",
                    "",
                    String(command?.targetWorkspacePath || "").trim() || process.cwd(),
                    commandExecTimeoutMs
                  )
                : runCodexResume(threadId, prompt || "See attached image and respond.", photoPath, commandExecTimeoutMs)
        , command.processorId);
        assistantText = getImmediateAssistantText(result, prompt);
      }
    }

    const ackedAt = new Date().toISOString();

    if (!assistantText && photoPath) {
      await updateProgress(command.id, "retrying-photo-read", {}, command.processorId);
      const retryPhotoPath = await createRetryPhotoVariant(command.id, photoPath);
      const result = await runWithProgressHeartbeat(command.id, "waiting-for-codex", () =>
        BRIDGE_EXECUTOR === "claude"
          ? runClaudePrint(
              photoPrompt || buildPhotoOnlyPrompt(command, photoOcrText),
              retryPhotoPath || photoPath,
              String(command?.targetWorkspacePath || "").trim() || process.cwd(),
              commandExecTimeoutMs
            )
          : runCodexExecEphemeral(
              photoPrompt || buildPhotoOnlyPrompt(command, photoOcrText),
              retryPhotoPath || photoPath,
              String(command?.targetWorkspacePath || "").trim() || process.cwd()
            )
      , command.processorId);
      assistantText = getImmediateAssistantText(result);
    }

    if (!assistantText && !photoPath && BRIDGE_EXECUTOR !== "claude" && !useFreshCodexThread) {
      await updateProgress(command.id, "reading-codex-reply", {}, command.processorId);
      assistantText = await getThreadFallbackAssistantText(command, threadId);
    }

    assistantText = stripPromptEcho(assistantText, photoPath ? photoPrompt : prompt);

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
      }, command.processorId);
      throw new Error(photoUnsupportedReason);
    }

    if (!assistantText) {
      assistantText = "Codex принял команду, но не вернул текст ответа. Я остановил запрос, чтобы очередь не зависала. Повторите запрос ещё раз.";
    }

    await updateProgress(command.id, "saving-reply", {}, command.processorId);

    const deliveryThreadId = sourceThreadId || threadId;
    const deliveryThreadLabel = sourceThreadLabel || command.threadLabel || deliveryThreadId;

    const completedEntry = {
      id: command.id,
      threadId: deliveryThreadId,
      threadLabel: deliveryThreadLabel,
      completedAt: ackedAt,
      assistantText,
      result: "answered",
      processorId: command.processorId
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
        }, command.processorId);
      } catch {}
    }

    if (command?.photo && isPhotoWaitTimeoutError(error)) {
      try {
        await updateProgress(command.id, "waiting-for-photo", {
          photoAttached: true,
          photoBytesPresent: Boolean(command.photo?.hasDataUrl || command.photo?.dataUrl || command.photoBytesPresent),
          photoSeenByBridge: true,
          photoProcessed: false,
          lastDiagnosticCode: "bridge_waiting_photo",
          lastDiagnosticDetail: "Bridge photo preparation timed out before delivery started."
        }, command.processorId);
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
      result: assistantText ? "answered" : "failed",
      processorId: command.processorId
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

function trackInFlightTask(task) {
  const wrapped = Promise.resolve(task)
    .catch((error) => {
      void appendBridgeErrorLog("bridgeWorker.unhandled", error);
    })
    .finally(() => {
      inFlightTasks.delete(wrapped);
    });

  inFlightTasks.add(wrapped);
  return wrapped;
}

function startLaneTask(lane, command) {
  const task = trackInFlightTask(processClaimedCommand(command));

  if (lane === "text") {
    textLaneTask = task;
  } else {
    generalLaneTask = task;
  }

  task.finally(() => {
    if (lane === "text" && textLaneTask === task) {
      textLaneTask = null;
      return;
    }

    if (lane === "general" && generalLaneTask === task) {
      generalLaneTask = null;
    }
  });

  return task;
}

while (true) {
  let claimedAny = false;

  if (!textLaneTask) {
    let command = null;

    try {
      command = await claimNextCommand({ textOnly: true });
    } catch (error) {
      await appendBridgeErrorLog("claimNextCommand.loop", error, {
        bridgeDispatchMode: BRIDGE_DISPATCH_MODE,
        inFlightCount: inFlightTasks.size,
        lane: "text",
        textOnly: true
      });
      await sleep(IDLE_DRAIN_POLL_MS);
    }

    if (command) {
      claimedAny = true;
      idleDrainUntil = Date.now() + IDLE_DRAIN_WINDOW_MS;
      startLaneTask("text", command);
    }
  }

  if (!generalLaneTask) {
    let command = null;

    try {
      command = await claimNextCommand();
    } catch (error) {
      await appendBridgeErrorLog("claimNextCommand.loop", error, {
        bridgeDispatchMode: BRIDGE_DISPATCH_MODE,
        inFlightCount: inFlightTasks.size,
        lane: "general",
        textOnly: false
      });
      await sleep(IDLE_DRAIN_POLL_MS);
    }

    if (command) {
      claimedAny = true;
      idleDrainUntil = Date.now() + IDLE_DRAIN_WINDOW_MS;
      startLaneTask("general", command);
    }
  }

  if (claimedAny) {
    continue;
  }

  if (!inFlightTasks.size) {
    if (Date.now() >= idleDrainUntil) {
      break;
    }

    await sleep(IDLE_DRAIN_POLL_MS);
    continue;
  }

  await Promise.race([
    Promise.allSettled([...inFlightTasks]),
    sleep(IDLE_DRAIN_POLL_MS)
  ]);
}

if (inFlightTasks.size) {
  await Promise.allSettled([...inFlightTasks]);
}

clearInterval(maintenanceTimer);
clearInterval(heartbeatTimer);

const remainingCommands = await safeFetchRecentCommands("remainingRecentCommands");
const remainingQueued = remainingCommands
  .filter((command) => command?.status === "queued")
  .sort((left, right) => String(left?.createdAt || "").localeCompare(String(right?.createdAt || "")));
const remainingProcessing = remainingCommands
  .filter((command) => command?.status === "processing")
  .sort((left, right) => String(left?.createdAt || "").localeCompare(String(right?.createdAt || "")));

await publishBridgeStatus({
  bridgeOnline: BRIDGE_EXECUTOR !== "claude",
  state: failed.length ? "degraded" : "idle",
  lastRunAt: new Date().toISOString(),
  lastSuccessAt: failed.length ? "" : new Date().toISOString(),
  pendingCount: remainingQueued.length + remainingProcessing.length,
  oldestPendingAt: remainingQueued[0]?.createdAt || remainingProcessing[0]?.createdAt || "",
  lastDeliveredCount: completed.length,
  lastError: failed[0]?.error || "",
  ...(BRIDGE_EXECUTOR === "claude"
    ? {
        claudeBridge: {
          online: true,
          state: failed.length ? "degraded" : "idle",
          lastRunAt: new Date().toISOString(),
          lastSuccessAt: failed.length ? "" : new Date().toISOString(),
          pendingCount: remainingQueued.length + remainingProcessing.length,
          oldestPendingAt: remainingQueued[0]?.createdAt || remainingProcessing[0]?.createdAt || "",
          lastDeliveredCount: completed.length,
          lastError: failed[0]?.error || ""
        }
      }
    : {
        localBridge: {
          online: true,
          managedBy: "launchd",
          state: failed.length ? "degraded" : "idle",
          lastRunAt: new Date().toISOString(),
          lastSuccessAt: failed.length ? "" : new Date().toISOString(),
          pendingCount: remainingQueued.length + remainingProcessing.length,
          oldestPendingAt: remainingQueued[0]?.createdAt || remainingProcessing[0]?.createdAt || "",
          lastDeliveredCount: completed.length,
          lastError: failed[0]?.error || ""
        }
      })
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
