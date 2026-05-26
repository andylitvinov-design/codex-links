import test from "node:test";
import assert from "node:assert/strict";

import {
  SECRET_REGISTRY,
  createVaultServer,
  formatReikiSupabaseStatus,
  formatYoutubeStatus,
  handleDelete,
  handleRead,
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

test("registry includes scoped Telegram, Codex Links, Monobank, YouTube, Reiki Supabase, and custom secrets", () => {
  assert.equal(SECRET_REGISTRY.hermes_telegram_bot_token.project, "Hermes");
  assert.equal(SECRET_REGISTRY.hermes_telegram_bot_token.service, "hermes-cloud");
  assert.equal(SECRET_REGISTRY.hermes_telegram_bot_token.account, "TELEGRAM_BOT_TOKEN");
  assert.equal(SECRET_REGISTRY.hermes_telegram_allowed_user_ids.project, "Hermes");
  assert.equal(SECRET_REGISTRY.hermes_telegram_allowed_user_ids.account, "TELEGRAM_ALLOWED_USER_IDS");
  assert.equal(SECRET_REGISTRY.telegram_bot_token.service, "openclaw-telegram-gateway");
  assert.equal(SECRET_REGISTRY.telegram_bot_token.account, "TELEGRAM_BOT_TOKEN");
  assert.equal(SECRET_REGISTRY.codex_links_write_token.service, "codex-links");
  assert.equal(SECRET_REGISTRY.monobank_token.service, "ezohata-finance");
  assert.equal(SECRET_REGISTRY.monobank_token.account, "MONOBANK_TOKEN");
  assert.equal(SECRET_REGISTRY.youtube_api_key.label, "YouTube Data API");
  assert.equal(SECRET_REGISTRY.youtube_api_key.service, "youtube-data-api");
  assert.equal(SECRET_REGISTRY.youtube_api_key.account, "YOUTUBE_API_KEY");
  assert.equal(SECRET_REGISTRY.youtube_api_key.optionalVars[0].name, "YOUTUBE_CHANNEL_HANDLE");
  assert.equal(SECRET_REGISTRY.youtube_api_key.optionalVars[0].defaultValue, "@shamanic_academy");
  assert.equal(SECRET_REGISTRY.reiki_supabase_access_token.label, "Reiki Yggdrasil / Supabase - SUPABASE_ACCESS_TOKEN");
  assert.equal(SECRET_REGISTRY.reiki_supabase_access_token.project, "Reiki Yggdrasil / Supabase");
  assert.equal(SECRET_REGISTRY.reiki_supabase_access_token.service, "reiki-yggdrasil-supabase");
  assert.equal(SECRET_REGISTRY.reiki_supabase_access_token.account, "SUPABASE_ACCESS_TOKEN");
  assert.equal(SECRET_REGISTRY.reiki_supabase_access_token.statusKey, "supabase_access_token_status");
  assert.equal(SECRET_REGISTRY.reiki_supabase_project_ref.label, "Reiki Yggdrasil / Supabase - SUPABASE_PROJECT_REF");
  assert.equal(SECRET_REGISTRY.reiki_supabase_project_ref.project, "Reiki Yggdrasil / Supabase");
  assert.equal(SECRET_REGISTRY.reiki_supabase_project_ref.service, "reiki-yggdrasil-supabase");
  assert.equal(SECRET_REGISTRY.reiki_supabase_project_ref.account, "SUPABASE_PROJECT_REF");
  assert.equal(SECRET_REGISTRY.reiki_supabase_project_ref.statusKey, "supabase_project_ref_status");
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
  const { runCommand } = makeRunner();
  const server = createVaultServer({ runCommand });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port, address } = server.address();
  assert.equal(address, "127.0.0.1");
  const response = await fetch(`http://127.0.0.1:${port}/api/secrets/catalog`);
  const data = await response.json();
  server.close();
  assert.equal(data.ok, true);
  assert.ok(data.secrets.find((entry) => entry.id === "hermes_telegram_bot_token" && entry.project === "Hermes"));
  assert.ok(data.secrets.find((entry) => entry.id === "telegram_bot_token"));
  const youtube = data.secrets.find((entry) => entry.id === "youtube_api_key");
  assert.equal(youtube.label, "YouTube Data API");
  assert.equal(youtube.account, "YOUTUBE_API_KEY");
  assert.equal(youtube.optionalVars[0].name, "YOUTUBE_CHANNEL_HANDLE");
  const supabaseToken = data.secrets.find((entry) => entry.id === "reiki_supabase_access_token");
  const supabaseProjectRef = data.secrets.find((entry) => entry.id === "reiki_supabase_project_ref");
  assert.equal(supabaseToken.label, "Reiki Yggdrasil / Supabase - SUPABASE_ACCESS_TOKEN");
  assert.equal(supabaseToken.account, "SUPABASE_ACCESS_TOKEN");
  assert.equal(supabaseProjectRef.label, "Reiki Yggdrasil / Supabase - SUPABASE_PROJECT_REF");
  assert.equal(supabaseProjectRef.account, "SUPABASE_PROJECT_REF");
  assert.equal(data.statuses.youtube_api_key.youtube_api_key_status, "configured");
  assert.equal(data.statuses.youtube_api_key.youtube_channel_handle, "default");
  assert.doesNotMatch(JSON.stringify(data), /secret-value/);
});

test("YouTube status endpoint reports configured or missing without returning the key", async () => {
  const { runCommand } = makeRunner({
    "security find-generic-password -s youtube-data-api -a YOUTUBE_API_KEY -w": {
      ok: true,
      code: 0,
      stdout: `${TEST_SECRET}\n`,
      stderr: ""
    }
  });
  const server = createVaultServer({ runCommand });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/secrets/status`);
  const data = await response.json();
  server.close();

  assert.equal(data.ok, true);
  assert.equal(data.youtube.youtube_api_key_status, "configured");
  assert.equal(data.youtube.youtube_channel_handle, "default");
  assert.equal(data.youtube.YOUTUBE_CHANNEL_HANDLE_default, "@shamanic_academy");
  assert.doesNotMatch(JSON.stringify(data), new RegExp(TEST_SECRET.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("Reiki Supabase status endpoint reports only configured or missing by secret name", async () => {
  const { runCommand } = makeRunner({
    "security find-generic-password -s reiki-yggdrasil-supabase -a SUPABASE_ACCESS_TOKEN -w": {
      ok: true,
      code: 0,
      stdout: `${TEST_SECRET}\n`,
      stderr: ""
    },
    "security find-generic-password -s reiki-yggdrasil-supabase -a SUPABASE_PROJECT_REF -w": {
      ok: false,
      code: 44,
      stdout: "",
      stderr: "not found"
    }
  });
  const server = createVaultServer({ runCommand });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/secrets/status`);
  const data = await response.json();
  server.close();

  assert.equal(data.ok, true);
  assert.equal(data.reikiSupabase.supabase_access_token_status, "configured");
  assert.equal(data.reikiSupabase.supabase_project_ref_status, "missing");
  assert.doesNotMatch(JSON.stringify(data), new RegExp(TEST_SECRET.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("YouTube status formatter prints only safe configured/default fields", () => {
  const text = formatYoutubeStatus({
    youtube: {
      youtube_api_key_status: "configured",
      youtube_channel_handle: "default"
    }
  });

  assert.equal(text, "YouTube API key: configured\nChannel handle: default");
  assert.doesNotMatch(text, /YOUTUBE_API_KEY|youtube-data-api|secret/i);
});

test("Reiki Supabase status formatter prints only safe secret names and presence", () => {
  const text = formatReikiSupabaseStatus({
    reikiSupabase: {
      supabase_access_token_status: "configured",
      supabase_project_ref_status: "missing"
    }
  });

  assert.equal(text, "SUPABASE_ACCESS_TOKEN: configured\nSUPABASE_PROJECT_REF: missing");
  assert.doesNotMatch(text, /reiki-yggdrasil-supabase|sbp_|secret/i);
});

test("Hermes Telegram secret is the default UI selection", () => {
  const html = htmlPage();
  assert.match(html, /<option value="hermes_telegram_bot_token" selected>Hermes \/ Telegram Bot Token<\/option>/);
});

test("Reiki Supabase UI selection masks secret input and exposes delete action", () => {
  const html = htmlPage({ selectedSecretType: "reiki_supabase_access_token" });
  assert.match(html, /<option value="reiki_supabase_access_token" selected>Reiki Yggdrasil \/ Supabase - SUPABASE_ACCESS_TOKEN<\/option>/);
  assert.match(html, /<input id="secret" type="password" autocomplete="off" autofocus \/>/);
  assert.match(html, /<button type="button" id="deleteSecret">Delete selected secret<\/button>/);
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

test("Reiki Supabase secrets are store-only replaceable Keychain entries", async () => {
  const { calls, runCommand } = makeRunner();
  const response = await handleSave({
    secretType: "reiki_supabase_access_token",
    secret: TEST_SECRET
  }, { runCommand });
  const data = JSON.parse(response.body);

  assert.equal(data.mode, "store-only");
  assert.equal(data.keychainService, "reiki-yggdrasil-supabase");
  assert.equal(data.keychainAccount, "SUPABASE_ACCESS_TOKEN");
  assert.deepEqual(calls.map((call) => call.command), ["security"]);
  assert.deepEqual(calls[0].args.slice(0, 7), ["add-generic-password", "-U", "-s", "reiki-yggdrasil-supabase", "-a", "SUPABASE_ACCESS_TOKEN", "-w"]);
  assert.equal(calls[0].args[7], TEST_SECRET);
  assert.doesNotMatch(response.body, new RegExp(TEST_SECRET.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("Reiki Supabase secret delete removes by service and account without values", async () => {
  const { calls, runCommand } = makeRunner();
  const response = await handleDelete({
    secretType: "reiki_supabase_project_ref"
  }, { runCommand });
  const data = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(data.deleted, true);
  assert.equal(data.keychainService, "reiki-yggdrasil-supabase");
  assert.equal(data.keychainAccount, "SUPABASE_PROJECT_REF");
  assert.deepEqual(calls.map((call) => call.command), ["security"]);
  assert.deepEqual(calls[0].args, ["delete-generic-password", "-s", "reiki-yggdrasil-supabase", "-a", "SUPABASE_PROJECT_REF"]);
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

test("YouTube Data API key is store-only and does not expose VITE-prefixed env", async () => {
  const { calls, runCommand } = makeRunner();
  const response = await handleSave({
    secretType: "youtube_api_key",
    secret: TEST_SECRET
  }, { runCommand });
  const data = JSON.parse(response.body);

  assert.equal(data.mode, "store-only");
  assert.equal(data.keychainService, "youtube-data-api");
  assert.equal(data.keychainAccount, "YOUTUBE_API_KEY");
  assert.deepEqual(calls.map((call) => call.command), ["security"]);
  assert.equal(calls[0].args[3], "youtube-data-api");
  assert.equal(calls[0].args[5], "YOUTUBE_API_KEY");
  assert.doesNotMatch(response.body, new RegExp(TEST_SECRET.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(JSON.stringify(SECRET_REGISTRY.youtube_api_key), /VITE_YOUTUBE_API_KEY/);
});

test("Hermes read endpoint returns configured Keychain values without logging", async () => {
  const { calls, runCommand } = makeRunner({
    "security find-generic-password -s hermes-cloud -a TELEGRAM_BOT_TOKEN -w": {
      ok: true,
      code: 0,
      stdout: `${TEST_SECRET}\n`,
      stderr: ""
    },
    "security find-generic-password -s hermes-cloud -a TELEGRAM_ALLOWED_USER_IDS -w": {
      ok: true,
      code: 0,
      stdout: "1001,1002\n",
      stderr: ""
    }
  });

  const response = await handleRead({
    project: "Hermes",
    names: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOWED_USER_IDS"]
  }, { runCommand });
  const data = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(data.secrets.TELEGRAM_BOT_TOKEN.present, true);
  assert.equal(data.secrets.TELEGRAM_BOT_TOKEN.value, TEST_SECRET);
  assert.equal(data.secrets.TELEGRAM_ALLOWED_USER_IDS.value, "1001,1002");
  assert.deepEqual(calls.map((call) => call.command), ["security", "security"]);
  assert.doesNotMatch(JSON.stringify(calls), new RegExp(TEST_SECRET.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("Reiki Supabase read endpoint is project-scoped for local runners", async () => {
  const { calls, runCommand } = makeRunner({
    "security find-generic-password -s reiki-yggdrasil-supabase -a SUPABASE_ACCESS_TOKEN -w": {
      ok: true,
      code: 0,
      stdout: `${TEST_SECRET}\n`,
      stderr: ""
    },
    "security find-generic-password -s reiki-yggdrasil-supabase -a SUPABASE_PROJECT_REF -w": {
      ok: true,
      code: 0,
      stdout: "PROJECT_REF_SHOULD_NOT_BE_LOGGED\n",
      stderr: ""
    }
  });

  const response = await handleRead({
    project: "Reiki Yggdrasil / Supabase",
    names: ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF"]
  }, { runCommand });
  const data = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(data.secrets.SUPABASE_ACCESS_TOKEN.present, true);
  assert.equal(data.secrets.SUPABASE_ACCESS_TOKEN.value, TEST_SECRET);
  assert.equal(data.secrets.SUPABASE_PROJECT_REF.value, "PROJECT_REF_SHOULD_NOT_BE_LOGGED");
  assert.deepEqual(calls.map((call) => call.command), ["security", "security"]);
  assert.doesNotMatch(JSON.stringify(calls), new RegExp(TEST_SECRET.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(JSON.stringify(calls), /PROJECT_REF_SHOULD_NOT_BE_LOGGED/);
});
