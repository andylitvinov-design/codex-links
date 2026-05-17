#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LABEL = "com.andriilitvinov.codex-links-openclaw-telegram-gateway";
const TOKEN_ENV = "TELEGRAM_BOT_TOKEN";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");

export function defaultLaunchdPaths({ homeDir = os.homedir(), repoRoot = REPO_ROOT } = {}) {
  return {
    repoRoot,
    nodeBin: process.execPath,
    runScript: path.join(repoRoot, "scripts", "openclaw-telegram-gateway.mjs"),
    plistPath: path.join(homeDir, "Library", "LaunchAgents", `${LABEL}.plist`),
    stdoutPath: path.join(homeDir, "Library", "Logs", "codex-links-openclaw-telegram-gateway.launchd.log"),
    stderrPath: path.join(homeDir, "Library", "Logs", "codex-links-openclaw-telegram-gateway.launchd.error.log")
  };
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildLaunchdPlist({
  label = LABEL,
  repoRoot = REPO_ROOT,
  nodeBin = process.execPath,
  runScript = path.join(repoRoot, "scripts", "openclaw-telegram-gateway.mjs"),
  stdoutPath,
  stderrPath
} = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodeBin)}</string>
    <string>${xmlEscape(runScript)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(repoRoot)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>${xmlEscape(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(stderrPath)}</string>
</dict>
</plist>
`;
}

export function buildLaunchctlCommands({ uid = process.getuid?.() ?? 501, plistPath, label = LABEL } = {}) {
  const service = `gui/${uid}/${label}`;
  return {
    bootout: ["bootout", service],
    bootstrap: ["bootstrap", `gui/${uid}`, plistPath],
    kickstart: ["kickstart", "-k", service],
    print: ["print", service],
    stop: ["bootout", service]
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 5000,
    killSignal: "SIGTERM",
    maxBuffer: 1024 * 1024,
    ...options
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error ? String(result.error.message || result.error) : ""
  };
}

function summarize(value) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(new RegExp(`(${TOKEN_ENV}\\s*[=:]\\s*)[^,}\\s]+`, "gi"), "$1[redacted]")
    .replace(/([A-Za-z0-9_-]*token[A-Za-z0-9_-]*\s*[=:]\s*)[^,}\s]+/gi, "$1[redacted]")
    .slice(0, 260);
}

function readLogExcerpt(filePath, { maxLines = 3 } = {}) {
  try {
    const lines = fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => summarize(line).trim())
      .filter(Boolean);
    return lines.slice(-maxLines).join(" | ");
  } catch {
    return "";
  }
}

function inspectLaunchctlTokenEnv() {
  const result = run("launchctl", ["getenv", TOKEN_ENV], { timeout: 1000 });
  return result.status === 0 && Boolean(result.stdout.trim());
}

function syncLaunchctlTokenEnv() {
  if (!process.env[TOKEN_ENV] || inspectLaunchctlTokenEnv()) return false;
  const result = run("launchctl", ["setenv", TOKEN_ENV, process.env[TOKEN_ENV]], { timeout: 1000 });
  return result.status === 0;
}

export function parseLaunchctlPrint(text) {
  const value = String(text || "");
  const pidMatch = value.match(/\bpid\s*=\s*(\d+)/);
  const stateMatch = value.match(/\bstate\s*=\s*([A-Za-z0-9_.-]+)/);
  return {
    installed: Boolean(value.trim()),
    running: Boolean(pidMatch && Number(pidMatch[1]) > 0),
    pid: pidMatch ? Number(pidMatch[1]) : 0,
    state: stateMatch ? stateMatch[1] : ""
  };
}

export function inspectLaunchd({ uid = process.getuid?.() ?? 501, label = LABEL } = {}) {
  const paths = defaultLaunchdPaths();
  const commands = buildLaunchctlCommands({ uid, label });
  const result = run("launchctl", commands.print);
  if (result.status !== 0) {
    return {
      installed: false,
      running: false,
      pid: 0,
      state: "",
      summary: summarize(result.stderr || result.error || result.stdout)
    };
  }
  const state = parseLaunchctlPrint(result.stdout);
  const stderrExcerpt = readLogExcerpt(paths.stderrPath);
  const stdoutExcerpt = readLogExcerpt(paths.stdoutPath);
  const logSummary = stderrExcerpt || stdoutExcerpt;
  return {
    ...state,
    summary: state.running ? "ok" : logSummary || "ok",
    rootCause: !state.running && state.state === "spawn" && logSummary
      ? `launchd state=spawn; recent log: ${logSummary}`
      : ""
  };
}

export function formatLaunchdStatusLines({ label = LABEL, state }) {
  return [
    `label=${label}`,
    `installed=${state.installed}`,
    `running=${state.running}`,
    `pid=${state.pid}`,
    `state=${state.state || "unknown"}`,
    `summary=${state.summary || "ok"}`,
    ...(state.rootCause ? [`rootCause=${state.rootCause}`] : [])
  ];
}

function install() {
  const paths = defaultLaunchdPaths();
  const commands = buildLaunchctlCommands({ plistPath: paths.plistPath });
  fs.mkdirSync(path.dirname(paths.plistPath), { recursive: true });
  fs.mkdirSync(path.dirname(paths.stdoutPath), { recursive: true });
  fs.writeFileSync(paths.plistPath, buildLaunchdPlist(paths));
  const launchctlTokenSynced = syncLaunchctlTokenEnv();

  run("launchctl", commands.bootout);
  const bootstrap = run("launchctl", commands.bootstrap);
  if (bootstrap.status !== 0) {
    console.error("status=failed");
    console.error(`rootCause=${summarize(bootstrap.stderr || bootstrap.error)}`);
    process.exit(1);
  }
  const kickstart = run("launchctl", commands.kickstart, { timeout: 3000, killSignal: "SIGTERM" });
  const state = inspectLaunchd();

  console.log(`status=${state.running ? "installed" : "needs_action"}`);
  console.log(`label=${LABEL}`);
  console.log(`plistPath=${paths.plistPath}`);
  console.log(`stdoutPath=${paths.stdoutPath}`);
  console.log(`stderrPath=${paths.stderrPath}`);
  for (const line of formatLaunchdStatusLines({ state })) console.log(line);
  console.log(`launchctlTokenPresent=${inspectLaunchctlTokenEnv()}`);
  console.log(`launchctlTokenSynced=${launchctlTokenSynced}`);
  if (!state.running) {
    console.log(`rootCause=${state.rootCause || summarize(kickstart.stderr || kickstart.error || kickstart.stdout) || "LaunchAgent installed but gateway is not running"}`);
    process.exit(1);
  }
}

function start() {
  const paths = defaultLaunchdPaths();
  if (!fs.existsSync(paths.plistPath)) install();
  const commands = buildLaunchctlCommands({ plistPath: paths.plistPath });
  const launchctlTokenSynced = syncLaunchctlTokenEnv();
  const result = run("launchctl", commands.kickstart, { timeout: 3000, killSignal: "SIGTERM" });
  const state = inspectLaunchd();
  const kickstartSummary = summarize(result.stderr || result.error || result.stdout);

  console.log(`status=${state.running ? "started" : "needs_action"}`);
  for (const line of formatLaunchdStatusLines({ state })) console.log(line);
  console.log(`launchctlTokenPresent=${inspectLaunchctlTokenEnv()}`);
  console.log(`launchctlTokenSynced=${launchctlTokenSynced}`);
  if (!state.running) {
    console.log(
      `rootCause=${state.rootCause || kickstartSummary || "launchctl kickstart returned but the service is not running"}`
    );
  }
  process.exit(state.running ? 0 : 1);
}

function stop() {
  const commands = buildLaunchctlCommands({ plistPath: defaultLaunchdPaths().plistPath });
  const result = run("launchctl", commands.stop);
  console.log(`status=${result.status === 0 ? "stopped" : "not_running"}`);
  if (result.status !== 0) console.log(`summary=${summarize(result.stderr || result.error)}`);
  process.exit(result.status === 0 ? 0 : 1);
}

function status() {
  const state = inspectLaunchd();
  for (const line of formatLaunchdStatusLines({ state })) console.log(line);
  process.exit(state.running ? 0 : 1);
}

function main() {
  const command = process.argv[2] || "status";
  if (command === "install") install();
  else if (command === "activate") start();
  else if (command === "start") start();
  else if (command === "stop") stop();
  else if (command === "status") status();
  else {
    console.error("status=failed");
    console.error("rootCause=Usage: openclaw-telegram-launchd.mjs install|start|stop|status|activate");
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
