#!/usr/bin/env node
/**
 * Claude Code Bridge entry point.
 *
 * This is a thin wrapper that runs bridge-codex-commands.mjs with
 * BRIDGE_EXECUTOR=claude and BRIDGE_DISPATCH_MODE=claude-bridge so that the
 * same bridge loop drives Claude Code instead of Codex.
 *
 * Usage (manual):
 *   LINKS_WRITE_TOKEN=<token> node scripts/bridge-claude-commands.mjs
 *
 * Usage (via launchd):
 *   launchctl load ~/Library/LaunchAgents/com.codexlinks.claude-bridge.plist
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bridgeScript = join(__dirname, "bridge-codex-commands.mjs");

const env = {
  ...process.env,
  BRIDGE_EXECUTOR: "claude",
  BRIDGE_DISPATCH_MODE: "claude-bridge"
};

const child = spawn(process.execPath, [bridgeScript], {
  env,
  stdio: "inherit",
  cwd: process.cwd()
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});

child.on("error", (error) => {
  console.error("Claude bridge wrapper error:", error.message);
  process.exit(1);
});
