#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TOKEN_ENV = "TELEGRAM_BOT_TOKEN";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");

export function parseDotenv(text) {
  const env = {};
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

export function loadDotenvFile(envPath = path.join(REPO_ROOT, ".env")) {
  try {
    return parseDotenv(fs.readFileSync(envPath, "utf8"));
  } catch {
    return {};
  }
}

export function loadRepoLocalEnv({
  repoRoot = REPO_ROOT,
  fileNames = [".dev.vars", ".env", ".env.local"]
} = {}) {
  return fileNames.reduce((env, fileName) => {
    return {
      ...env,
      ...loadDotenvFile(path.join(repoRoot, fileName))
    };
  }, {});
}

export function buildGatewayEnv({
  baseEnv = process.env,
  dotenv = loadRepoLocalEnv()
} = {}) {
  return {
    ...dotenv,
    ...baseEnv
  };
}

export function redactSecrets(value) {
  return String(value || "")
    .replace(new RegExp(`(${TOKEN_ENV}\\s*[=:]\\s*)[^\\s,}]+`, "g"), "$1[redacted]")
    .replace(/([A-Za-z0-9_-]*token[A-Za-z0-9_-]*\s*[=:]\s*)[^,}\s]+/gi, "$1[redacted]");
}

export function diagnoseGatewayEnv(env = process.env) {
  if (env[TOKEN_ENV]) return "";
  return 'Direct `openclaw gateway` does not load repo .env. Start gateway through the wrapper.';
}

function writeRedacted(stream, chunk) {
  stream.write(redactSecrets(chunk.toString()));
}

function main() {
  const env = buildGatewayEnv();
  const diagnosis = diagnoseGatewayEnv(env);

  if (diagnosis) {
    console.error(`status=failed`);
    console.error(`rootCause=${diagnosis}`);
    process.exit(2);
  }

  console.log("status=starting");
  console.log("command=openclaw gateway");
  console.log(`localTokenPresent=${Boolean(env[TOKEN_ENV])}`);

  const child = spawn("openclaw", ["gateway"], {
    cwd: REPO_ROOT,
    env,
    stdio: ["inherit", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => writeRedacted(process.stdout, chunk));
  child.stderr.on("data", (chunk) => writeRedacted(process.stderr, chunk));
  child.on("error", (error) => {
    console.error(`status=failed`);
    console.error(`rootCause=${redactSecrets(error.message || error)}`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
