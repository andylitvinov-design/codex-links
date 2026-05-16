#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import process from "node:process";

const TOKEN_ENV = "TELEGRAM_BOT_TOKEN";
const LOCAL_ENV_FILE = ".env";

function parseArgs(argv = process.argv.slice(2)) {
  const out = { dryRun: false, enable: false, token: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") out.dryRun = true;
    if (arg === "--enable") out.enable = true;
    if (arg === "--token") out.token = argv[index + 1] || "";
    if (arg.startsWith("--token=")) out.token = arg.slice("--token=".length);
  }
  return out;
}

function looksLikeTelegramToken(token) {
  return /^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(String(token || "").trim());
}

function parseEnvFile(text) {
  const values = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2] || "";
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function loadLocalEnv(filePath = LOCAL_ENV_FILE) {
  if (!fs.existsSync(filePath)) return {};
  const values = parseEnvFile(fs.readFileSync(filePath, "utf8"));
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return values;
}

function quoteEnvValue(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function upsertEnvValue(text, key, value) {
  const line = `${key}=${quoteEnvValue(value)}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(text)) return text.replace(pattern, line);
  const trimmed = text.trimEnd();
  return `${trimmed}${trimmed ? "\n" : ""}${line}\n`;
}

function writeLocalToken(token, { envFile = LOCAL_ENV_FILE, dryRun = false } = {}) {
  const cleanToken = String(token || "").trim();
  if (!looksLikeTelegramToken(cleanToken)) {
    throw new Error("Invalid Telegram bot token format. Expected value like 123456789:AA...");
  }
  const current = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
  const next = upsertEnvValue(current, TOKEN_ENV, cleanToken);
  if (!dryRun) {
    fs.writeFileSync(envFile, next, { mode: 0o600 });
    try {
      fs.chmodSync(envFile, 0o600);
    } catch {
      // Best-effort only on platforms that support chmod.
    }
    process.env[TOKEN_ENV] = cleanToken;
  }
  return { envFile, changed: next !== current, dryRun };
}

function readHiddenLine(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return "";
  process.stdout.write(prompt);
  const restore = spawnSync("sh", ["-c", "stty -echo < /dev/tty"], { stdio: "ignore" });
  try {
    const buffer = fs.readFileSync(0, "utf8");
    return buffer.split(/\r?\n/)[0] || "";
  } finally {
    if (restore.status === 0) spawnSync("sh", ["-c", "stty echo < /dev/tty"], { stdio: "ignore" });
    process.stdout.write("\n");
  }
}

function runOpenClaw(args, { dryRun } = {}) {
  const commandArgs = ["config", "set", ...args];
  if (dryRun) commandArgs.push("--dry-run");
  const result = spawnSync("openclaw", commandArgs, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
  const label = `openclaw ${commandArgs.join(" ")}`;
  return {
    label,
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
    .slice(0, 240);
}

function printResult(result) {
  console.log(`${result.status === 0 ? "ok" : "failed"} ${result.label}`);
  const summary = summarize(result.stdout || result.stderr || result.error);
  if (summary) console.log(`summary=${summary}`);
}

function main() {
  const args = parseArgs();
  loadLocalEnv();

  const tokenFromCli = args.token || "";
  const tokenFromPrompt = args.enable && !tokenFromCli && !process.env[TOKEN_ENV] ? readHiddenLine("Paste TELEGRAM_BOT_TOKEN: ") : "";
  const tokenToSave = tokenFromCli || tokenFromPrompt;

  if (tokenToSave) {
    try {
      const saved = writeLocalToken(tokenToSave, { dryRun: args.dryRun });
      console.log(`localEnvFile=${saved.envFile}`);
      console.log(`localTokenSaved=${args.dryRun ? "dry_run" : "true"}`);
    } catch (error) {
      console.log(`status=invalid_token`);
      console.log(`message=${summarize(error.message)}`);
      process.exit(2);
    }
  }

  const tokenPresent = Boolean(process.env[TOKEN_ENV] || tokenToSave);

  const steps = [
    [["channels.telegram.dmPolicy", "\"pairing\"", "--strict-json"], "pairing-only DM policy"],
    [["channels.telegram.groupPolicy", "\"allowlist\"", "--strict-json"], "allowlist-only group policy"],
    [["channels.telegram.groups", "{}", "--strict-json"], "remove wildcard groups"]
  ];

  if (tokenPresent) {
    steps.unshift([
      ["channels.telegram.botToken", "--ref-provider", "default", "--ref-source", "env", "--ref-id", TOKEN_ENV],
      "Telegram token env ref"
    ]);
  }

  const desiredEnabled = args.enable && tokenPresent;
  steps.push([
    ["channels.telegram.enabled", desiredEnabled ? "true" : "false", "--strict-json"],
    desiredEnabled ? "enable Telegram" : "keep Telegram disabled until local token is present"
  ]);

  let failed = false;
  console.log(`status=starting`);
  console.log(`dryRun=${args.dryRun}`);
  console.log(`localTokenPresent=${tokenPresent}`);
  console.log(`requestedEnable=${args.enable}`);

  for (const [stepArgs, description] of steps) {
    console.log(`step=${description}`);
    const result = runOpenClaw(stepArgs, { dryRun: args.dryRun });
    printResult(result);
    if (result.status !== 0) failed = true;
  }

  if (args.enable && !tokenPresent) {
    console.log(`status=staged_needs_local_secret`);
    console.log(`message=Run: npm run setup:openclaw:telegram -- --enable --token "<TELEGRAM_BOT_TOKEN>"`);
    process.exit(2);
  }

  console.log(`status=${failed ? "failed" : args.dryRun ? "validated" : "updated"}`);
  console.log(`nextCommand=npm run doctor:openclaw:telegram`);
  process.exit(failed ? 1 : 0);
}

export {
  loadLocalEnv,
  looksLikeTelegramToken,
  parseArgs,
  parseEnvFile,
  summarize,
  upsertEnvValue,
  writeLocalToken
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
