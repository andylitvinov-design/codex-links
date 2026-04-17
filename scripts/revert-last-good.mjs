#!/usr/bin/env node

import { execFileSync } from "node:child_process";

function run(args, options = {}) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  }).trim();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function readOption(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return fallback;
  }

  return String(process.argv[index + 1] || "").trim() || fallback;
}

const commit = readOption("--commit", "HEAD");
const baseBranch = readOption("--base", "main");
const push = hasFlag("--push");
const branch = readOption(
  "--branch",
  `rollback/${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-")}`
);

try {
  const dirty = run(["status", "--porcelain"]);
  if (dirty) {
    fail("Working tree is not clean. Commit or stash current changes before creating a rollback branch.");
  }

  run(["rev-parse", "--verify", commit]);
  run(["fetch", "origin", baseBranch], { stdio: "inherit" });
  run(["switch", "-c", branch, `origin/${baseBranch}`], { stdio: "inherit" });
  run(["revert", "--no-edit", commit], { stdio: "inherit" });

  if (push) {
    run(["push", "-u", "origin", branch], { stdio: "inherit" });
  }

  console.log(`Rollback branch ready: ${branch}`);
  console.log(`Reverted commit: ${commit}`);
  if (!push) {
    console.log(`Next: git push -u origin ${branch}`);
  }
  console.log("Next: open a PR back to main and confirm Cloudflare Pages deploy status.");
} catch (error) {
  fail(error.stderr || error.message);
}
