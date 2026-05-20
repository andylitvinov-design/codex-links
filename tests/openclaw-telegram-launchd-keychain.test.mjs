import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const SCRIPT = resolve("scripts/openclaw-telegram-launchd.mjs");

async function makeBin(dir, name, body) {
  const path = join(dir, name);
  await writeFile(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}

function runNode(args, env) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

test("repair returns needs_action without shell or Keychain token and leaks no secret", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openclaw-no-token-"));
  await makeBin(dir, "security", "exit 44");
  await makeBin(dir, "launchctl", `
if [[ "\${1:-}" == "getenv" ]]; then exit 1; fi
if [[ "\${1:-}" == "print" ]]; then echo "state = spawn"; exit 0; fi
exit 1
`);
  const result = await runNode(["repair"], {
    PATH: `${dir}:${process.env.PATH}`,
    HOME: dir
  });
  assert.equal(result.code, 1);
  const data = JSON.parse(result.stdout);
  assert.equal(data.status, "needs_action");
  assert.equal(data.token_source, "missing");
  assert.match(data.next_action, /export TELEGRAM_BOT_TOKEN/);
  assert.doesNotMatch(result.stdout + result.stderr, /\d{6,}:[A-Za-z0-9_-]{20,}/);
});

test("repair stores shell token in Keychain and seeds launchd without printing token", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openclaw-shell-token-"));
  const log = join(dir, "calls.log");
  await makeBin(dir, "security", `
printf 'security:%s\n' "$*" >> "${log}"
exit 0
`);
  await makeBin(dir, "launchctl", `
printf 'launchctl:%s\n' "$*" >> "${log}"
if [[ "\${1:-}" == "getenv" ]]; then exit 1; fi
if [[ "\${1:-}" == "setenv" ]]; then exit 0; fi
if [[ "\${1:-}" == "print" ]]; then echo "pid = 12345"; echo "state = running"; exit 0; fi
if [[ "\${1:-}" == "kickstart" ]]; then exit 0; fi
exit 0
`);
  const token = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef";
  const result = await runNode(["repair"], {
    PATH: `${dir}:${process.env.PATH}`,
    HOME: dir,
    TELEGRAM_BOT_TOKEN: token
  });
  assert.equal(result.code, 0);
  const data = JSON.parse(result.stdout);
  assert.equal(data.status, "ok");
  assert.equal(data.token_source, "shell");
  assert.equal(data.keychain_used, true);
  const calls = await readFile(log, "utf8");
  assert.match(calls, /security:add-generic-password -U -s openclaw-telegram-gateway -a TELEGRAM_BOT_TOKEN -w/);
  assert.match(calls, /launchctl:setenv TELEGRAM_BOT_TOKEN/);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("repair reads Keychain token when shell token is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openclaw-keychain-token-"));
  const log = join(dir, "calls.log");
  const token = "654321:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef";
  await makeBin(dir, "security", `
printf 'security:%s\n' "$*" >> "${log}"
if [[ "\${1:-}" == "find-generic-password" ]]; then printf '${token}\n'; exit 0; fi
exit 1
`);
  await makeBin(dir, "launchctl", `
printf 'launchctl:%s\n' "$*" >> "${log}"
if [[ "\${1:-}" == "getenv" ]]; then exit 1; fi
if [[ "\${1:-}" == "setenv" ]]; then exit 0; fi
if [[ "\${1:-}" == "print" ]]; then echo "pid = 22222"; echo "state = running"; exit 0; fi
if [[ "\${1:-}" == "kickstart" ]]; then exit 0; fi
exit 0
`);
  const result = await runNode(["repair"], {
    PATH: `${dir}:${process.env.PATH}`,
    HOME: dir
  });
  assert.equal(result.code, 0);
  const data = JSON.parse(result.stdout);
  assert.equal(data.status, "ok");
  assert.equal(data.token_source, "keychain");
  const calls = await readFile(log, "utf8");
  assert.match(calls, /security:find-generic-password -s openclaw-telegram-gateway -a TELEGRAM_BOT_TOKEN -w/);
  assert.match(calls, /launchctl:setenv TELEGRAM_BOT_TOKEN/);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
