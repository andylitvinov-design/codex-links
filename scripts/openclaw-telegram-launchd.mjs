#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";

const SERVICE_NAME = "openclaw-telegram-gateway";
const TOKEN_ACCOUNT = "TELEGRAM_BOT_TOKEN";
const LAUNCH_LABEL = "com.andylitvinov.openclaw.telegram-gateway";
const DEFAULT_TIMEOUT_MS = 8000;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPT_DIR);
const GATEWAY_SCRIPT = join(SCRIPT_DIR, "openclaw-telegram-gateway.mjs");

function redact(value = "") {
  return String(value)
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_TELEGRAM_BOT_TOKEN]")
    .replace(/(TELEGRAM_BOT_TOKEN=)[^\s]+/g, "$1[REDACTED]")
    .replace(/(-w\s+)[^\s]+/g, "$1[REDACTED]")
    .replace(/(Bot token:\s*)[^\s]+/gi, "$1[REDACTED]");
}

function short(value = "", max = 300) {
  return redact(String(value).replace(/[\r\n\t]+/g, " ").slice(0, max));
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function runCommand(command, args = [], options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const env = options.env || process.env;
  return new Promise((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1000).unref();
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise({
        ok: false,
        code: 127,
        signal: null,
        timedOut,
        stdout,
        stderr: String(error?.message || error)
      });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({
        ok: code === 0 && !timedOut,
        code,
        signal,
        timedOut,
        stdout,
        stderr
      });
    });
  });
}

async function readKeychainToken() {
  const result = await runCommand("security", [
    "find-generic-password",
    "-s", SERVICE_NAME,
    "-a", TOKEN_ACCOUNT,
    "-w"
  ]);
  if (!result.ok) return { ok: false, source: "keychain", error: short(result.stderr || result.stdout) };
  const token = result.stdout.trim();
  return token ? { ok: true, source: "keychain", token } : { ok: false, source: "keychain", error: "empty token" };
}

async function writeKeychainToken(token) {
  if (!token) return { ok: false, error: "empty token" };
  const result = await runCommand("security", [
    "add-generic-password",
    "-U",
    "-s", SERVICE_NAME,
    "-a", TOKEN_ACCOUNT,
    "-w", token
  ]);
  return {
    ok: result.ok,
    error: result.ok ? "" : short(result.stderr || result.stdout)
  };
}

async function launchctl(args) {
  return runCommand("launchctl", args);
}

async function seedLaunchdToken(token) {
  if (!token) return { ok: false, error: "empty token" };
  const result = await launchctl(["setenv", TOKEN_ACCOUNT, token]);
  return { ok: result.ok, error: result.ok ? "" : short(result.stderr || result.stdout) };
}

async function getLaunchdTokenPresent() {
  const result = await launchctl(["getenv", TOKEN_ACCOUNT]);
  return Boolean(result.ok && result.stdout.trim());
}

function plistPath() {
  return join(process.env.HOME || "", "Library", "LaunchAgents", `${LAUNCH_LABEL}.plist`);
}

function buildPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(LAUNCH_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(process.execPath)}</string>
    <string>${xmlEscape(GATEWAY_SCRIPT)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(REPO_ROOT)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${xmlEscape(join(process.env.HOME || "/tmp", "Library", "Logs", "openclaw-telegram-gateway.out.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(join(process.env.HOME || "/tmp", "Library", "Logs", "openclaw-telegram-gateway.err.log"))}</string>
</dict>
</plist>
`;
}

async function inspectPlist() {
  const path = plistPath();
  const exists = existsSync(path);
  if (!exists) return { path, exists, labelMatches: false, hasToken: false, gatewayScript: GATEWAY_SCRIPT, gatewayExists: existsSync(GATEWAY_SCRIPT) };
  const content = await readFile(path, "utf8").catch(() => "");
  return {
    path,
    exists,
    labelMatches: content.includes(`<string>${LAUNCH_LABEL}</string>`),
    hasToken: content.includes(TOKEN_ACCOUNT) || /\d{6,}:[A-Za-z0-9_-]{20,}/.test(content),
    gatewayScript: GATEWAY_SCRIPT,
    gatewayExists: existsSync(GATEWAY_SCRIPT)
  };
}

async function ensurePlist() {
  const before = await inspectPlist();
  if (!before.gatewayExists) {
    return { ok: false, changed: false, before, error: `Gateway script missing: ${GATEWAY_SCRIPT}` };
  }
  if (before.exists && before.labelMatches && !before.hasToken) {
    return { ok: true, changed: false, before, after: before };
  }
  await mkdir(dirname(before.path), { recursive: true });
  await writeFile(before.path, buildPlist(), { mode: 0o600 });
  const after = await inspectPlist();
  return { ok: after.exists && after.labelMatches && !after.hasToken, changed: true, before, after };
}

function parseLaunchdStatus(printResult) {
  const text = printResult.stdout || "";
  const running = /pid\s*=\s*[1-9]\d*/.test(text);
  const pidMatch = text.match(/pid\s*=\s*([1-9]\d*)/);
  const stateMatch = text.match(/state\s*=\s*([^\s]+)/);
  const lastExitMatch = text.match(/last exit code\s*=\s*([^\s]+)/i);
  const missing = /Could not find service|No such process|not found|Bad request|does not exist/i.test(printResult.stderr || "");
  return {
    installed: printResult.ok || !missing,
    running,
    pid: pidMatch ? Number(pidMatch[1]) : 0,
    state: stateMatch ? stateMatch[1] : (printResult.ok ? "unknown" : "missing"),
    lastExitCode: lastExitMatch ? lastExitMatch[1] : "",
    stderr_excerpt: short(printResult.stderr),
    stdout_excerpt: running ? "" : short(text)
  };
}

async function getStatus() {
  const guiTarget = `gui/${process.getuid?.() ?? ""}/${LAUNCH_LABEL}`;
  const printResult = await launchctl(["print", guiTarget]);
  const parsed = parseLaunchdStatus(printResult);
  const tokenPresent = await getLaunchdTokenPresent();
  const plist = await inspectPlist();
  return {
    ...parsed,
    tokenPresent,
    plistExists: plist.exists,
    plistLabelMatches: plist.labelMatches,
    plistHasToken: plist.hasToken,
    gatewayExists: plist.gatewayExists,
    plistPath: plist.path
  };
}

async function restartLaunchAgent() {
  const plist = plistPath();
  const guiDomain = `gui/${process.getuid?.() ?? ""}`;
  const target = `${guiDomain}/${LAUNCH_LABEL}`;
  const steps = [];
  if (existsSync(plist)) {
    steps.push(["bootout", guiDomain, plist]);
    steps.push(["bootstrap", guiDomain, plist]);
  }
  steps.push(["kickstart", "-k", target]);

  const results = [];
  for (const args of steps) {
    const result = await launchctl(args);
    results.push({
      args,
      ok: result.ok,
      error: short(result.stderr || result.stdout)
    });
  }
  return results;
}

async function resolveTokenForRepair() {
  const shellToken = process.env.TELEGRAM_BOT_TOKEN || "";
  if (shellToken) {
    const stored = await writeKeychainToken(shellToken);
    return { ok: true, token: shellToken, source: "shell", storedInKeychain: stored.ok, keychainError: stored.error };
  }
  const keychain = await readKeychainToken();
  if (keychain.ok) return { ok: true, token: keychain.token, source: "keychain", storedInKeychain: true, keychainError: "" };
  return { ok: false, source: "missing", error: keychain.error || "No TELEGRAM_BOT_TOKEN in shell or macOS Keychain." };
}

async function repair() {
  const before = await getStatus();
  const plistRepair = await ensurePlist();
  if (!plistRepair.ok) {
    return {
      ok: false,
      status: "needs_action",
      before,
      plist_repair: plistRepair,
      message: plistRepair.error || "LaunchAgent plist repair failed."
    };
  }

  const tokenResult = await resolveTokenForRepair();
  if (!tokenResult.ok) {
    return {
      ok: false,
      status: "needs_action",
      before,
      plist_repair: plistRepair,
      token_source: "missing",
      message: "No Telegram token found in shell or macOS Keychain.",
      next_action: "Run once: export TELEGRAM_BOT_TOKEN='<token>'; npm run repair:openclaw:telegram-gateway"
    };
  }

  const seeded = await seedLaunchdToken(tokenResult.token);
  if (!seeded.ok) {
    return {
      ok: false,
      status: "needs_action",
      before,
      plist_repair: plistRepair,
      token_source: tokenResult.source,
      keychain_used: tokenResult.source === "keychain" || tokenResult.storedInKeychain,
      message: `Failed to seed launchd env: ${seeded.error}`
    };
  }

  const restart = await restartLaunchAgent();
  const after = await getStatus();
  return {
    ok: after.running && after.pid > 0,
    status: after.running && after.pid > 0 ? "ok" : "needs_action",
    before,
    after,
    plist_repair: plistRepair,
    token_source: tokenResult.source,
    keychain_used: tokenResult.source === "keychain" || tokenResult.storedInKeychain,
    restart,
    message: after.running && after.pid > 0
      ? "OpenClaw Telegram gateway is running."
      : "Token and plist were repaired, but gateway is not running yet. Inspect redacted status excerpts."
  };
}

async function doctor() {
  const plist = await inspectPlist();
  return {
    ok: true,
    service: SERVICE_NAME,
    label: LAUNCH_LABEL,
    plist: plist.path,
    plistExists: plist.exists,
    plistLabelMatches: plist.labelMatches,
    plistHasToken: plist.hasToken,
    gatewayScript: plist.gatewayScript,
    gatewayExists: plist.gatewayExists,
    tokenInShell: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    tokenInLaunchd: await getLaunchdTokenPresent(),
    status: await getStatus()
  };
}

function printResult(result) {
  const safe = JSON.stringify(result, (_, value) => {
    if (typeof value === "string") return redact(value);
    return value;
  }, 2);
  console.log(safe);
}

export {
  SERVICE_NAME,
  TOKEN_ACCOUNT,
  LAUNCH_LABEL,
  redact,
  readKeychainToken,
  writeKeychainToken,
  seedLaunchdToken,
  getStatus,
  repair,
  doctor,
  runCommand,
  inspectPlist,
  ensurePlist,
  buildPlist,
  parseLaunchdStatus
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const action = process.argv[2] || "status";
  let result;
  if (action === "repair" || action === "start") {
    result = await repair();
  } else if (action === "doctor") {
    result = await doctor();
  } else if (action === "status") {
    result = await getStatus();
  } else if (action === "install") {
    result = await ensurePlist();
  } else {
    result = {
      ok: false,
      status: "needs_action",
      message: `Unknown action: ${action}`,
      allowed: ["status", "start", "repair", "doctor", "install"]
    };
  }
  printResult(result);
  if (result.ok === false && action !== "status" && action !== "doctor") process.exitCode = 1;
}
