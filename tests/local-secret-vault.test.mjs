import test from "node:test";
import assert from "node:assert/strict";

import {
  SECRET_REGISTRY,
  createVaultServer,
  handleSave,
  htmlPage,
  redact,
  resolveSecretConfig
} from "../scripts/local-secret-vault.mjs";

const TEST_SECRET = "123456:TEST_SECRET_VALUE_SHOULD_NOT_LEAK";

function makeRunner(responses = {}) {
  const calls = [];
  const runCommand = async (command, args, options = {}) => {
    calls.push({ command, args, options });
    const key = `${command} ${args.join(" ")}`;
    if (responses[key]) return responses[key];
    if (command === "security") return { ok: true, code: 0, stdout: "", stderr: "" };
    if (command === "launchctl") return { ok: true, code: 0, stdout: "", stderr: "" };
    if (command === "npm" && args.includes("repair:openclaw:telegram-gateway")) {
      return {
        ok: true,
        code: 0,
        stdout: JSON.stringify({ ok: true, keychain_used: true }),
        stderr: ""
      };
    }
    if (command === "npm" && args.includes("status:openclaw:telegram-gateway")) {
      return {
        ok: true,
        code: 0,
        stdout: JSON.stringify({
          running: true,
          pid: 4321,
          tokenPresent: true,
          plistHasToken: false
        }),
        stderr: ""
      };
    }
    return { ok: true, code: 0, stdout: "", stderr: "" };
  };
  return { calls, runCommand };
}

test("registry includes scoped Telegram, Codex Links, Monobank, and custom secrets", () => {
  assert.equal(SECRET_REGISTRY.telegram_bot_token.service, "openclaw-telegram-gateway");
  assert.equal(SECRET_REGISTRY.telegram_bot_token.account, "TELEGRAM_BOT_TOKEN");
  assert.equal(SECRET_REGISTRY.codex_links_write_token.service, "codex-links");
  assert.equal(SECRET_REGISTRY.monobank_token.service, "ezohata-finance");
  assert.equal(SECRET_REGISTRY.monobank_token.account, "MONOBANK_TOKEN");
  assert.equal(SECRET_REGISTRY.custom_secret.custom, true);
});

test("custom secret requires service and account", () => {
  assert.equal(resolveSecretConfig({ secretType: "custom_secret" }).ok, false);
  const resolved = resolveSecretConfig({ secretType: "custom_secret", customService: "svc", customAccount: "acct" });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.value.service, "svc");
  assert.equal(resolved.value.account, "acct");
});

test("unknown secret type is rejected", () => {
  assert.deepEqual(resolveSecretConfig({ secretType: "missing" }), { ok: false, error: "Unknown secret type." });
});

test("redact hides common token output patterns", () => {
  const output = redact("TOKEN=secret-value token abc -w secret");
  assert.doesNotMatch(output, /secret-value|abc -w secret/);
  assert.match(output, /REDACTED/);
});

test("empty secret is rejected before storage", async () => {
  const response = await handleSave({ secretType: "telegram_bot_token", secret: "" });
  assert.equal(response.status, 400);
  assert.match(response.body, /Secret value is required/);
});

test("catalog endpoint exposes metadata only", async () => {
  const server = createVaultServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port, address } = server.address();
  assert.equal(address, "127.0.0.1");
  const response = await fetch(`http://127.0.0.1:${port}/api/secrets/catalog`);
  const data = await response.json();
  server.close();
  assert.equal(data.ok, true);
  assert.ok(data.secrets.find((entry) => entry.id === "telegram_bot_token"));
  assert.doesNotMatch(JSON.stringify(data), /secret-value/);
});

test("telegram secret can be preselected in the UI", () => {
  const html = htmlPage({ selectedSecretType: "telegram_bot_token" });
  assert.match(html, /<option value="telegram_bot_token" selected>Telegram Bot Token<\/option>/);
});

test("saving a secret writes only to Keychain and redacts the response", async () => {
  const { calls, runCommand } = makeRunner();
  const response = await handleSave({
    secretType: "custom_secret",
    customService: "local-test-service",
    customAccount: "LOCAL_TEST_TOKEN",
    secret: TEST_SECRET
  }, { runCommand });
  const data = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(data.saved, true);
  assert.equal(data.mode, "store-only");
  assert.deepEqual(calls.map((call) => call.command), ["security"]);
  assert.deepEqual(calls[0].args.slice(0, 7), ["add-generic-password", "-U", "-s", "local-test-service", "-a", "LOCAL_TEST_TOKEN", "-w"]);
  assert.equal(calls[0].args[7], TEST_SECRET);
  assert.doesNotMatch(response.body, new RegExp(TEST_SECRET.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("telegram apply seeds launchd, runs repair/status, and returns redacted parsed status", async () => {
  const { calls, runCommand } = makeRunner();
  const response = await handleSave({
    secretType: "telegram_bot_token",
    secret: TEST_SECRET
  }, { runCommand });
  const data = JSON.parse(response.body);

  assert.deepEqual(calls.map((call) => call.command), ["security", "launchctl", "npm", "npm"]);
  assert.deepEqual(calls[1].args.slice(0, 2), ["setenv", "TELEGRAM_BOT_TOKEN"]);
  assert.equal(calls[1].args[2], TEST_SECRET);
  assert.equal(data.keychainUsed, true);
  assert.equal(data.plistHasToken, false);
  assert.equal(data.running, true);
  assert.equal(data.pid, 4321);
  assert.equal(data.tokenPresent, true);
  assert.equal(data.status, "running");
  assert.doesNotMatch(response.body, new RegExp(TEST_SECRET.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("Monobank token is store-only and does not run imports or OpenClaw repair", async () => {
  const { calls, runCommand } = makeRunner();
  const response = await handleSave({
    secretType: "monobank_token",
    secret: TEST_SECRET
  }, { runCommand });
  const data = JSON.parse(response.body);

  assert.equal(data.mode, "store-only");
  assert.deepEqual(calls.map((call) => call.command), ["security"]);
  assert.equal(calls[0].args[3], "ezohata-finance");
  assert.equal(calls[0].args[5], "MONOBANK_TOKEN");
  assert.doesNotMatch(JSON.stringify(calls.map((call) => call.args.join(" "))), /import|sync|openclaw|repair/i);
});
