#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_NAME = "codex-links";
const TOKEN_ENV = "TELEGRAM_BOT_TOKEN";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");

function unique(values) {
  return [...new Set(values.filter(Boolean).map((value) => path.resolve(String(value))))];
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function isCodexLinksCheckout(dir) {
  const pkg = readJson(path.join(dir, "package.json"));
  return pkg?.name === PROJECT_NAME && fs.existsSync(path.join(dir, "scripts", "openclaw-telegram-setup.mjs"));
}

function parentDirs(startDir) {
  const dirs = [];
  let current = path.resolve(startDir);
  while (true) {
    dirs.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dirs;
}

function scanForCheckout(root, maxDepth = 4) {
  const queue = [{ dir: path.resolve(root), depth: 0 }];
  const seen = new Set();

  while (queue.length) {
    const { dir, depth } = queue.shift();
    if (seen.has(dir)) continue;
    seen.add(dir);
    if (isCodexLinksCheckout(dir)) return dir;
    if (depth >= maxDepth) continue;

    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".wrangler") continue;
      queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }

  return "";
}

export function findCodexLinksCheckout({
  startDir = process.cwd(),
  homeDir = os.homedir(),
  scriptRepoRoot = SCRIPT_REPO_ROOT,
  extraRoots = []
} = {}) {
  const directCandidates = unique([
    process.env.CODEX_LINKS_DIR,
    ...parentDirs(startDir),
    scriptRepoRoot,
    path.join(homeDir, "projects", "MYPROJECTS", "links"),
    path.join(homeDir, "projects", "MYPROJECTS", PROJECT_NAME),
    path.join(homeDir, "projects", PROJECT_NAME),
    path.join(homeDir, PROJECT_NAME)
  ]);

  for (const candidate of directCandidates) {
    if (isCodexLinksCheckout(candidate)) return candidate;
  }

  const scanRoots = unique([
    ...extraRoots,
    path.join(homeDir, "projects", "MYPROJECTS"),
    path.join(homeDir, "projects")
  ]);

  for (const root of scanRoots) {
    const found = fs.existsSync(root) ? scanForCheckout(root) : "";
    if (found) return found;
  }

  return "";
}

function parseArgs(argv) {
  const out = {
    enable: argv.includes("--enable"),
    dryRun: argv.includes("--dry-run"),
    skipDoctor: argv.includes("--skip-doctor"),
    gateway: argv.includes("--gateway") || argv.includes("--start-gateway"),
    installGateway: argv.includes("--install-gateway"),
    activateGateway: argv.includes("--activate-gateway"),
    status: argv.includes("--status"),
    pairing: argv.includes("--pairing"),
    token: process.env[TOKEN_ENV] || ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--token") out.token = argv[index + 1] || "";
    if (arg.startsWith("--token=")) out.token = arg.slice("--token=".length);
  }

  return out;
}

function runNpm(repoRoot, args, env) {
  return spawnSync("npm", args, {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    stdio: "inherit"
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = findCodexLinksCheckout();

  if (!repoRoot) {
    console.error("status=failed");
    console.error("rootCause=Could not find a local codex-links checkout.");
    process.exit(1);
  }

  if (args.enable && !args.token) {
    console.error("status=failed");
    console.error(`rootCause=--enable requires ${TOKEN_ENV}; pass --token or set ${TOKEN_ENV}.`);
    process.exit(2);
  }

  const env = { ...process.env };
  if (args.token) {
    env[TOKEN_ENV] = args.token;
    env.CODEX_LINKS_TELEGRAM_TOKEN_INPUT = args.token;
  }

  console.log(`status=starting`);
  console.log(`repoRoot=${repoRoot}`);
  console.log(`localTokenPresent=${Boolean(args.token)}`);

  if (args.gateway) {
    const gateway = runNpm(repoRoot, ["run", "start:openclaw:telegram-gateway"], env);
    process.exit(gateway.status ?? 1);
  }
  if (args.installGateway) {
    const install = runNpm(repoRoot, ["run", "install:openclaw:telegram-gateway"], env);
    process.exit(install.status ?? 1);
  }
  if (args.activateGateway) {
    const activate = runNpm(repoRoot, ["run", "activate:openclaw:telegram-gateway"], env);
    process.exit(activate.status ?? 1);
  }
  if (args.status) {
    const status = runNpm(repoRoot, ["run", "status:openclaw:telegram-gateway"], env);
    process.exit(status.status ?? 1);
  }
  if (args.pairing) {
    const pairing = runNpm(repoRoot, ["run", "pairing:openclaw:telegram"], env);
    process.exit(pairing.status ?? 1);
  }

  const setupArgs = ["run", "setup:openclaw:telegram", "--"];
  if (args.enable) setupArgs.push("--enable");
  if (args.dryRun) setupArgs.push("--dry-run");

  const setup = runNpm(repoRoot, setupArgs, env);
  if ((setup.status ?? 1) !== 0) process.exit(setup.status ?? 1);

  if (!args.skipDoctor) {
    const doctor = runNpm(repoRoot, ["run", "doctor:openclaw:telegram"], env);
    if ((doctor.status ?? 1) !== 0) process.exit(doctor.status ?? 1);
  }

  console.log("status=completed");
}

function isDirectRun() {
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]);
  } catch {
    return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] || "");
  }
}

if (isDirectRun()) {
  main();
}
