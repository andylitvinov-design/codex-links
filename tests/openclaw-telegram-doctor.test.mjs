import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  evaluateDoctor,
  inspectTelegramConfig,
  parseKeyValueLines,
  parseWranglerSecretList
} from "../scripts/openclaw-telegram-doctor.mjs";

import {
  looksLikeTelegramToken,
  parseArgs,
  parseEnvFile,
  summarize,
  upsertEnvValue,
  writeLocalToken
} from "../scripts/openclaw-telegram-setup.mjs";

test("OpenClaw Telegram doctor accepts env ref with pairing and allowlist", () => {
  const result = inspectTelegramConfig({
    channels: {
      telegram: {
        enabled: true,
        botToken: { source: "env", provider: "default", id: "TELEGRAM_BOT_TOKEN" },
        dmPolicy: "pairing",
        groupPolicy: "allowlist",
        groups: {}
      }
    }
  });

  assert.equal(result.tokenRefOk, true);
  assert.equal(result.dmPolicyOk, true);
  assert.equal(result.groupPolicyOk, true);
  assert.equal(result.wildcardGroupPresent, false);
});

test("OpenClaw Telegram doctor rejects wildcard groups", () => {
  const result = inspectTelegramConfig({
    channels: {
      telegram: {
        botToken: { source: "env", provider: "default", id: "TELEGRAM_BOT_TOKEN" },
        dmPolicy: "pairing",
        groupPolicy: "allowlist",
        groups: { "*": { requireMention: true } }
      }
    }
  });

  assert.equal(result.wildcardGroupPresent, true);
});

test("OpenClaw Telegram doctor parses Cloudflare secret names without values", () => {
  const names = parseWranglerSecretList(`
The "production" environment of your Pages project "codex-links" has access to the following secrets:
  - ADMIN_TOKEN: Value Encrypted
  - TELEGRAM_BOT_TOKEN: Value Encrypted
`);

  assert.equal(names.has("TELEGRAM_BOT_TOKEN"), true);
  assert.equal(names.has("ADMIN_TOKEN"), true);
});

test("OpenClaw Telegram doctor identifies Pages-local environment split", () => {
  const result = evaluateDoctor({
    config: {
      channels: {
        telegram: {
          enabled: false,
          botToken: { source: "env", provider: "default", id: "TELEGRAM_BOT_TOKEN" },
          dmPolicy: "pairing",
          groupPolicy: "allowlist",
          groups: {}
        }
      }
    },
    localTokenPresent: false,
    wranglerOutput: "  - TELEGRAM_BOT_TOKEN: Value Encrypted\n",
    probeOutput: "gatewayReachable=false\ngatewayError=timeout\n"
  });

  assert.equal(result.ok, false);
  assert.match(result.rootCause, /local OpenClaw process environment/);
});

test("OpenClaw Telegram doctor reads gateway fields from probe stdout summary", () => {
  const result = parseKeyValueLines("stdout_summary=runtime=2026.4.26; gatewayReachable=false; gatewayError=timeout; tasksActive=0\n");

  assert.equal(result.gatewayReachable, "false");
  assert.equal(result.gatewayError, "timeout");
});

test("OpenClaw Telegram setup parses one-command token argument", () => {
  const result = parseArgs(["--enable", "--token", "123456789:ABCDEFGHIJKLMNOPQRST_uvwx"]);

  assert.equal(result.enable, true);
  assert.equal(result.token, "123456789:ABCDEFGHIJKLMNOPQRST_uvwx");
});

test("OpenClaw Telegram setup accepts BotFather token shape", () => {
  assert.equal(looksLikeTelegramToken("123456789:ABCDEFGHIJKLMNOPQRST_uvwx"), true);
  assert.equal(looksLikeTelegramToken("not-a-token"), false);
});

test("OpenClaw Telegram setup redacts token values from output summaries", () => {
  const token = "123456789:ABCDEFGHIJKLMNOPQRST_uvwx";
  const output = summarize(`TELEGRAM_BOT_TOKEN=${token} botToken:${token}`);

  assert.equal(output.includes(token), false);
  assert.match(output, /redacted/);
});

test("OpenClaw Telegram setup writes token only to local env file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-telegram-"));
  const envFile = path.join(dir, ".env");
  const token = "123456789:ABCDEFGHIJKLMNOPQRST_uvwx";

  const result = writeLocalToken(token, { envFile });
  const values = parseEnvFile(fs.readFileSync(envFile, "utf8"));

  assert.equal(result.changed, true);
  assert.equal(values.TELEGRAM_BOT_TOKEN, token);
});

test("OpenClaw Telegram setup upserts token without printing existing file content", () => {
  const token = "123456789:ABCDEFGHIJKLMNOPQRST_uvwx";
  const next = upsertEnvValue("OTHER=value\n", "TELEGRAM_BOT_TOKEN", token);
  const values = parseEnvFile(next);

  assert.equal(values.OTHER, "value");
  assert.equal(values.TELEGRAM_BOT_TOKEN, token);
});

test("local env files are ignored while example env can be committed", () => {
  const ignore = fs.readFileSync(".gitignore", "utf8");

  assert.match(ignore, /^\.env$/m);
  assert.match(ignore, /^\.env\.\*$/m);
  assert.match(ignore, /^!\.env\.example$/m);
});
