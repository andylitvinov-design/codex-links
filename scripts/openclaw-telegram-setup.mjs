#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const TOKEN_ENV = "TELEGRAM_BOT_TOKEN";

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
    .replace(/([A-Za-z0-9_-]*token[A-Za-z0-9_-]*)\s*[:=]\s*[^,}\s]+/gi, "$1=[redacted]")
    .slice(0, 240);
}

function printResult(result) {
  console.log(`${result.status === 0 ? "ok" : "failed"} ${result.label}`);
  const summary = summarize(result.stdout || result.stderr || result.error);
  if (summary) console.log(`summary=${summary}`);
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const enableRequested = process.argv.includes("--enable");
  const tokenPresent = Boolean(process.env[TOKEN_ENV]);

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

  const desiredEnabled = enableRequested && tokenPresent;
  steps.push([
    ["channels.telegram.enabled", desiredEnabled ? "true" : "false", "--strict-json"],
    desiredEnabled ? "enable Telegram" : "keep Telegram disabled until local token is present"
  ]);

  let failed = false;
  console.log(`status=starting`);
  console.log(`dryRun=${dryRun}`);
  console.log(`localTokenPresent=${tokenPresent}`);
  console.log(`requestedEnable=${enableRequested}`);

  for (const [args, description] of steps) {
    console.log(`step=${description}`);
    const result = runOpenClaw(args, { dryRun });
    printResult(result);
    if (result.status !== 0) failed = true;
  }

  if (enableRequested && !tokenPresent) {
    console.log(`status=staged_needs_local_secret`);
    console.log(`message=Set ${TOKEN_ENV} in the local OpenClaw daemon environment, then rerun with --enable.`);
    process.exit(2);
  }

  console.log(`status=${failed ? "failed" : dryRun ? "validated" : "updated"}`);
  console.log(`nextCommand=npm run doctor:openclaw:telegram`);
  process.exit(failed ? 1 : 0);
}

main();
