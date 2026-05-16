#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadLocalEnv } from "./openclaw-telegram-setup.mjs";

const PROJECT_NAME = "codex-links";
const TOKEN_ENV = "TELEGRAM_BOT_TOKEN";

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
    .replace(/\d{5,}:[A-Za-z0-9_-]{20,}/g, "[redacted-telegram-token]")
    .replace(/([A-Za-z0-9_-]*token[A-Za-z0-9_-]*)\s*[:=]\s*[^,}\s]+/gi, "$1=[redacted]")
    .slice(0, 260);
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

export function buildDiagnosis({ configInspection, localTokenPresent, cloudflareTokenPresent, probe }) {
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
  if (!localTokenPresent) {
    return "Cloudflare Pages has TELEGRAM_BOT_TOKEN, but the local OpenClaw process environment does not.";
  }
  if (probe.gatewayReachable === "false") {
    return `OpenClaw gateway is not reachable locally: ${probe.gatewayError || "unknown"}.`;
  }
  if (!configInspection.enabled) {
    return "Telegram is configured safely but remains disabled in OpenClaw.";
  }
  return "OpenClaw Telegram setup looks ready from non-secret checks.";
}

export function evaluateDoctor({ config, localTokenPresent, wranglerOutput, probeOutput }) {
  const configInspection = inspectTelegramConfig(config);
  const cloudflareSecrets = parseWranglerSecretList(wranglerOutput);
  const probe = parseKeyValueLines(probeOutput);
  const cloudflareTokenPresent = cloudflareSecrets.has(TOKEN_ENV);
  const rootCause = buildDiagnosis({
    configInspection,
    localTokenPresent,
    cloudflareTokenPresent,
    probe
  });
  const ok =
    configInspection.tokenRefOk &&
    configInspection.dmPolicyOk &&
    configInspection.groupPolicyOk &&
    !configInspection.wildcardGroupPresent &&
    cloudflareTokenPresent &&
    localTokenPresent &&
    probe.gatewayReachable === "true" &&
    configInspection.enabled;

  return {
    ok,
    rootCause,
    cloudflareTokenPresent,
    localTokenPresent,
    probe,
    config: configInspection
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
  loadLocalEnv();
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
  const result = evaluateDoctor({
    config,
    localTokenPresent: Boolean(process.env[TOKEN_ENV]),
    wranglerOutput: wrangler.stdout,
    probeOutput: probe.stdout
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
    gatewayReachable: result.probe.gatewayReachable || "needs_verification",
    gatewayError: result.probe.gatewayError || "needs_verification",
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
  }

  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
