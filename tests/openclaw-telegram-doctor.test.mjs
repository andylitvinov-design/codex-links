import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateDoctor,
  inspectTelegramConfig,
  parseKeyValueLines,
  parseWranglerSecretList
} from "../scripts/openclaw-telegram-doctor.mjs";

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
