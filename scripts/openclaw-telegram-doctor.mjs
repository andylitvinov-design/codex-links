#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspectLaunchd } from "./openclaw-telegram-launchd.mjs";
import { loadRepoLocalEnv } from "./openclaw-telegram-gateway.mjs";

const PROJECT_NAME = "codex-links";
const TOKEN_ENV = "TELEGRAM_BOT_TOKEN";
export const OPENCLAW_TELEGRAM_LINK = "https://t.me/andycodex_openclaw_bot?start=openclaw";

export function formatReadyLink() {
  return `Open this link:\n${OPENCLAW_TELEGRAM_LINK}`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
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
    .replace(new RegExp(`${TOKEN_ENV}=[^\\s]+`, "g"), `${TOKEN_ENV}=[redacted]`)
    .replace(/([A-Za-z0-9_-]*token[A-Za-z0-9_-]*)\s*[:=]\s*[^,}\s]+/gi, "$1=[redacted]")
    .slice(0, 260);
}

function hasSecretRefResolutionError(probe) {
  const haystack = [
    probe.gatewayError,
    probe.stderr_summary,
    probe.stdout_summary,
    probe.stderr,
    probe.stdout
  ].join(" ");
  return /SecretRefResolutionError/i.test(haystack) && /TELEGRAM_BOT_TOKEN/i.test(haystack);
}

export function parseKeyValueLines(text) {
  const out = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_.-]+)=(.*)$/);
    if (match) out[match[1]] = match[2];
  }
  if (out.stdout_summary) {
    for (const part of out.stdout_summary.split(";")) {
      const match = part.trim().match(/^([A-Za-z0-9_.-]+)=(.*)$/);
      if (match && !out[match[1]]) out[match[1]] = match[2];
    }
  }
  return out;
}

export function parseWranglerSecretList(text) {
  const names = new Set();
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/^\s*-\s*([A-Z0-9_]+):\s*Value Encrypted\b/);
    if (match) names.add(match[1]);
  }
  return names;
}

export function inspectTelegramConfig(config) {
  const telegram = config?.channels?.telegram || {};
  const botToken = telegram.botToken;
  const groups = telegram.groups && typeof telegram.groups === "object" ? telegram.groups : {};
  const tokenRefOk =
    botToken &&
    typeof botToken === "object" &&
    botToken.source === "env" &&
    botToken.provider === "default" &&
    botToken.id === TOKEN_ENV;

  return {
    enabled: telegram.enabled === true,
    tokenRefOk,
    dmPolicy: telegram.dmPolicy || "pairing",
    dmPolicyOk: (telegram.dmPolicy || "pairing") === "pairing",
    groupPolicy: telegram.groupPolicy || "allowlist",
    groupPolicyOk: (telegram.groupPolicy || "allowlist") === "allowlist",
    wildcardGroupPresent: Object.prototype.hasOwnProperty.call(groups, "*"),
    groupCount: Object.keys(groups).length
  };
}

export function inspectGatewayStatus(text) {
  try {
    const data = JSON.parse(String(text || ""));
    const scopes = data?.rpc?.auth?.scopes || [];
    return {
      serviceLoaded: data?.service?.loaded === true,
      serviceRunning: data?.service?.runtime?.status === "running" || data?.service?.runtime?.state === "active",
      rpcOk: data?.rpc?.ok === true,
      capability: data?.rpc?.capability || "",
      operatorScopePresent: Array.isArray(scopes) && scopes.some((scope) => String(scope).startsWith("operator.")),
      summary: data?.rpc?.capability || data?.service?.runtime?.status || ""
    };
  } catch {
    return {
      serviceLoaded: false,
      serviceRunning: false,
      rpcOk: false,
      capability: "",
      operatorScopePresent: false,
      summary: summarize(text)
    };
  }
}

export function inspectPairingState(text) {
  try {
    const data = JSON.parse(String(text || ""));
    const requests = Array.isArray(data?.requests) ? data.requests : [];
    return {
      pendingCount: requests.length,
      paired: requests.length === 0,
      summary: requests.length ? "pending_pairing_requests" : "ready_for_pairing_link"
    };
  } catch {
    return {
      pendingCount: 0,
      paired: false,
      summary: summarize(text)
    };
  }
}

export function buildDiagnosis({
  configInspection,
  localTokenPresent,
  cloudflareTokenPresent,
  probe,
  launchdStatus = { installed: true, running: true },
  gatewayStatus = { operatorScopePresent: true },
  pairingState = { paired: true, pendingCount: 0 }
}) {
  if (configInspection.wildcardGroupPresent) {
    return "OpenClaw Telegram config still contains wildcard group access.";
  }
  if (!configInspection.tokenRefOk) {
    return "OpenClaw Telegram token is not configured as an env ref.";
  }
  if (!configInspection.dmPolicyOk || !configInspection.groupPolicyOk) {
    return "OpenClaw Telegram policy is not locked to pairing plus allowlist.";
  }
  if (!cloudflareTokenPresent) {
    return "Cloudflare Pages does not list TELEGRAM_BOT_TOKEN for codex-links.";
  }
  if (hasSecretRefResolutionError(probe)) {
    return "Direct `openclaw gateway` does not load repo .env. Start gateway through the wrapper.";
  }
  if (!launchdStatus.installed) {
    return "OpenClaw Telegram gateway LaunchAgent is not installed.";
  }
  if (!launchdStatus.running) {
    return "OpenClaw Telegram gateway LaunchAgent is installed but not running.";
  }
  if (!localTokenPresent) {
    return "Cloudflare Pages has TELEGRAM_BOT_TOKEN, but the local OpenClaw gateway environment does not. Add TELEGRAM_BOT_TOKEN to the repo local env file and start gateway through the wrapper.";
  }
  if (probe.gatewayReachable === "false") {
    return `OpenClaw gateway is not reachable locally: ${probe.gatewayError || "unknown"}.`;
  }
  if (!configInspection.enabled) {
    return "Telegram is configured safely but remains disabled in OpenClaw.";
  }
  if (!gatewayStatus.operatorScopePresent) {
    return "OpenClaw gateway is running, but the current RPC auth has no operator scope.";
  }
  if (!pairingState.paired || pairingState.pendingCount > 0) {
    return "OpenClaw gateway is running, but Telegram is not paired yet.";
  }
  return "OpenClaw Telegram setup looks ready from non-secret checks.";
}

export function evaluateDoctor({
  config,
  localTokenPresent,
  wranglerOutput,
  probeOutput,
  launchdStatus,
  gatewayStatusOutput = "",
  pairingOutput = ""
}) {
  const configInspection = inspectTelegramConfig(config);
  const cloudflareSecrets = parseWranglerSecretList(wranglerOutput);
  const probe = parseKeyValueLines(probeOutput);
  const cloudflareTokenPresent = cloudflareSecrets.has(TOKEN_ENV);
  const gatewayStatus = inspectGatewayStatus(gatewayStatusOutput);
  const pairingState = inspectPairingState(pairingOutput);
  const rootCause = buildDiagnosis({
    configInspection,
    localTokenPresent,
    cloudflareTokenPresent,
    probe,
    launchdStatus,
    gatewayStatus,
    pairingState
  });
  const ok =
    configInspection.tokenRefOk &&
    configInspection.dmPolicyOk &&
    configInspection.groupPolicyOk &&
    !configInspection.wildcardGroupPresent &&
    cloudflareTokenPresent &&
    localTokenPresent &&
    probe.gatewayReachable === "true" &&
    configInspection.enabled &&
    (launchdStatus?.running ?? true) &&
    gatewayStatus.operatorScopePresent &&
    pairingState.paired;

  return {
    ok,
    rootCause,
    cloudflareTokenPresent,
    localTokenPresent,
    probe,
    config: configInspection,
    launchd: launchdStatus || { installed: true, running: true },
    gatewayStatus,
    pairing: pairingState
  };
}

function readConfig(configPath) {
  try {
    return JSON.parse(fs.readFileSync(expandHome(configPath), "utf8"));
  } catch {
    return null;
  }
}

function expandHome(filePath) {
  if (filePath === "~") return os.homedir();
  if (filePath.startsWith("~/")) return path.join(os.homedir(), filePath.slice(2));
  return filePath;
}

function defaultConfigPath() {
  return path.join(os.homedir(), ".openclaw", "openclaw.json");
}

function main() {
  const json = process.argv.includes("--json");
  const skipCloudflare = process.argv.includes("--skip-cloudflare");
  const skipProbe = process.argv.includes("--skip-probe");
  const openclaw = run("bash", ["-lc", "command -v openclaw"]);
  const binary = openclaw.stdout.trim();
  const version = binary ? run(binary, ["--version"]).stdout.trim() || "needs_verification" : "not_found";
  const configFileRaw = binary ? run(binary, ["config", "file"]).stdout.trim() || defaultConfigPath() : defaultConfigPath();
  const configFile = expandHome(configFileRaw);
  const configValidate = binary ? run(binary, ["config", "validate"]) : { status: 1, stdout: "", stderr: "openclaw not found" };
  const config = readConfig(configFile) || {};
  const wrangler = skipCloudflare
    ? { stdout: "", stderr: "", status: 0 }
    : run("npx", ["wrangler", "pages", "secret", "list", "--project-name", PROJECT_NAME]);
  const probe = skipProbe ? { stdout: "" } : run("bash", ["scripts/probe-openclaw-run.sh"]);
  const launchdStatus = inspectLaunchd();
  const gatewayStatus = skipProbe ? { stdout: "" } : run("openclaw", ["gateway", "status", "--json", "--timeout", "3000"]);
  const pairing = skipProbe ? { stdout: "" } : run("openclaw", ["pairing", "list", "telegram", "--json"]);
  const localEnv = loadRepoLocalEnv();
  const result = evaluateDoctor({
    config,
    localTokenPresent: Boolean(process.env[TOKEN_ENV] || localEnv[TOKEN_ENV]),
    wranglerOutput: wrangler.stdout,
    probeOutput: probe.stdout,
    launchdStatus,
    gatewayStatusOutput: gatewayStatus.stdout,
    pairingOutput: pairing.stdout
  });

  const output = {
    status: result.ok ? "ok" : "needs_action",
    binary: binary || "not_found",
    version: summarize(version),
    configFile,
    configValid: configValidate.status === 0,
    cloudflareTokenPresent: result.cloudflareTokenPresent,
    localTokenPresent: result.localTokenPresent,
    telegramEnabled: result.config.enabled,
    tokenRefOk: result.config.tokenRefOk,
    dmPolicy: result.config.dmPolicy,
    groupPolicy: result.config.groupPolicy,
    wildcardGroupPresent: result.config.wildcardGroupPresent,
    gatewayLaunchdInstalled: result.launchd.installed,
    gatewayLaunchdRunning: result.launchd.running,
    gatewayReachable: result.probe.gatewayReachable || "needs_verification",
    gatewayError: result.probe.gatewayError || "needs_verification",
    operatorScopePresent: result.gatewayStatus.operatorScopePresent,
    telegramPairing: result.pairing.summary,
    rootCause: result.rootCause,
    wranglerCheck: skipCloudflare ? "skipped" : wrangler.status === 0 ? "ok" : summarize(wrangler.stderr || wrangler.error),
    probeCheck: skipProbe ? "skipped" : probe.status === 0 ? "ok" : summarize(probe.stderr || probe.error)
  };

  if (json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    for (const [key, value] of Object.entries(output)) {
      console.log(`${key}=${value}`);
    }
    if (result.ok) {
      console.log(formatReadyLink());
    }
  }

  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
