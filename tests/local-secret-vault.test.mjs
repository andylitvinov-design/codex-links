import test from "node:test";
import assert from "node:assert/strict";

import {
  SECRET_REGISTRY,
  createVaultServer,
  handleSave,
  redact,
  resolveSecretConfig
} from "../scripts/local-secret-vault.mjs";

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
