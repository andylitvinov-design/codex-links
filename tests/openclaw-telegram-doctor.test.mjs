import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  evaluateDoctor,
  formatReadyLink,
  inspectGatewayStatus,
  inspectPairingState,
  inspectTelegramConfig,
  OPENCLAW_TELEGRAM_LINK,
  parseKeyValueLines,
  parseWranglerSecretList
} from "../scripts/openclaw-telegram-doctor.mjs";
import {
  findCodexLinksCheckout,
  isCodexLinksCheckout
} from "../scripts/openclaw-telegram-anywhere.mjs";
import {
  buildGatewayEnv,
  diagnoseGatewayEnv,
  loadRepoLocalEnv,
  parseDotenv,
  redactSecrets
} from "../scripts/openclaw-telegram-gateway.mjs";
import {
  buildLaunchctlCommands,
  buildLaunchdPlist,
  formatLaunchdStatusLines,
  parseLaunchctlPrint
} from "../scripts/openclaw-telegram-launchd.mjs";

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
    probeOutput: "gatewayReachable=false\ngatewayError=timeout\n",
    launchdStatus: { installed: true, running: true }
  });

  assert.equal(result.ok, false);
  assert.match(result.rootCause, /local OpenClaw gateway environment/);
  assert.match(result.rootCause, /repo local env file/);
});

test("OpenClaw Telegram doctor diagnoses direct gateway missing repo env clearly", () => {
  const result = evaluateDoctor({
    config: {
      channels: {
        telegram: {
          enabled: true,
          botToken: { source: "env", provider: "default", id: "TELEGRAM_BOT_TOKEN" },
          dmPolicy: "pairing",
          groupPolicy: "allowlist",
          groups: {}
        }
      }
    },
    localTokenPresent: true,
    wranglerOutput: "  - TELEGRAM_BOT_TOKEN: Value Encrypted\n",
    probeOutput:
      'gatewayReachable=false\ngatewayError=SecretRefResolutionError: Environment variable "TELEGRAM_BOT_TOKEN" is missing or empty.\n',
    launchdStatus: { installed: true, running: true }
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.rootCause,
    "Direct `openclaw gateway` does not load repo .env. Start gateway through the wrapper."
  );
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

test("OpenClaw Telegram anywhere helper finds checkout from outside repo root", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-links-anywhere-"));
  const checkout = path.join(tmp, "nested", "links");
  const outside = path.join(tmp, "outside");
  fs.mkdirSync(path.join(checkout, "scripts"), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(checkout, "package.json"), JSON.stringify({ name: "codex-links" }));
  fs.writeFileSync(path.join(checkout, "scripts", "openclaw-telegram-setup.mjs"), "");

  assert.equal(isCodexLinksCheckout(checkout), true);
  assert.equal(
    findCodexLinksCheckout({
      startDir: outside,
      homeDir: path.join(tmp, "home"),
      scriptRepoRoot: path.join(tmp, "not-a-repo"),
      extraRoots: [tmp]
    }),
    checkout
  );
});

test("OpenClaw Telegram gateway wrapper loads TELEGRAM_BOT_TOKEN from dotenv", () => {
  const parsed = parseDotenv("TELEGRAM_BOT_TOKEN=secret-from-env-file\nOTHER=value\n");

  assert.equal(parsed.TELEGRAM_BOT_TOKEN, "secret-from-env-file");
  assert.equal(parsed.OTHER, "value");
});

test("OpenClaw Telegram gateway wrapper passes dotenv env to child process env", () => {
  const env = buildGatewayEnv({
    baseEnv: { PATH: "/bin" },
    dotenv: { TELEGRAM_BOT_TOKEN: "secret-from-env-file" }
  });

  assert.equal(env.TELEGRAM_BOT_TOKEN, "secret-from-env-file");
  assert.equal(env.PATH, "/bin");
});

test("OpenClaw Telegram gateway wrapper loads repo local env files", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-links-env-"));
  fs.writeFileSync(path.join(tmp, ".dev.vars"), "TELEGRAM_BOT_TOKEN=from-dev-vars\n");
  fs.writeFileSync(path.join(tmp, ".env.local"), "OTHER=from-local\n");

  const env = loadRepoLocalEnv({ repoRoot: tmp });

  assert.equal(env.TELEGRAM_BOT_TOKEN, "from-dev-vars");
  assert.equal(env.OTHER, "from-local");
});

test("OpenClaw Telegram gateway wrapper redacts token values", () => {
  const output = redactSecrets("TELEGRAM_BOT_TOKEN=secret token: secret2 apiToken=secret3");

  assert.doesNotMatch(output, /secret/);
  assert.match(output, /TELEGRAM_BOT_TOKEN=\[redacted\]/);
  assert.match(output, /token: \[redacted\]/i);
  assert.match(output, /apiToken=\[redacted\]/);
});

test("OpenClaw Telegram gateway wrapper diagnoses missing env for direct gateway", () => {
  assert.equal(
    diagnoseGatewayEnv({}),
    "Direct `openclaw gateway` does not load repo .env. Start gateway through the wrapper."
  );
  assert.equal(diagnoseGatewayEnv({ TELEGRAM_BOT_TOKEN: "present" }), "");
});

test("OpenClaw Telegram launchd plist starts the gateway wrapper without secrets", () => {
  const plist = buildLaunchdPlist({
    label: "com.example.openclaw",
    repoRoot: "/repo",
    nodeBin: "/usr/bin/node",
    runScript: "/repo/scripts/openclaw-telegram-gateway.mjs",
    stdoutPath: "/Users/me/Library/Logs/out.log",
    stderrPath: "/Users/me/Library/Logs/err.log"
  });

  assert.match(plist, /<string>\/usr\/bin\/node<\/string>/);
  assert.match(plist, /openclaw-telegram-gateway\.mjs/);
  assert.match(plist, /codex-links|com\.example\.openclaw/);
  assert.doesNotMatch(plist, /TELEGRAM_BOT_TOKEN/);
  assert.doesNotMatch(plist, /secret/);
});

test("OpenClaw Telegram launchctl command construction targets user LaunchAgent", () => {
  const commands = buildLaunchctlCommands({
    uid: 501,
    plistPath: "/Users/me/Library/LaunchAgents/com.example.openclaw.plist",
    label: "com.example.openclaw"
  });

  assert.deepEqual(commands.bootstrap, [
    "bootstrap",
    "gui/501",
    "/Users/me/Library/LaunchAgents/com.example.openclaw.plist"
  ]);
  assert.deepEqual(commands.kickstart, ["kickstart", "-k", "gui/501/com.example.openclaw"]);
});

test("OpenClaw Telegram launchd status parser detects running service", () => {
  const status = parseLaunchctlPrint("state = running\npid = 12345\n");

  assert.equal(status.installed, true);
  assert.equal(status.running, true);
  assert.equal(status.pid, 12345);
});

test("OpenClaw Telegram launchd status summary is explicit when service is not running", () => {
  const lines = formatLaunchdStatusLines({
    label: "com.example.openclaw",
    state: {
      installed: true,
      running: false,
      pid: 0,
      state: "spawn",
      summary: "ok"
    }
  });

  assert.deepEqual(lines, [
    "label=com.example.openclaw",
    "installed=true",
    "running=false",
    "pid=0",
    "state=spawn",
    "summary=ok"
  ]);
});

test("OpenClaw Telegram doctor diagnoses gateway lifecycle states", () => {
  const base = {
    config: {
      channels: {
        telegram: {
          enabled: true,
          botToken: { source: "env", provider: "default", id: "TELEGRAM_BOT_TOKEN" },
          dmPolicy: "pairing",
          groupPolicy: "allowlist",
          groups: {}
        }
      }
    },
    localTokenPresent: true,
    wranglerOutput: "  - TELEGRAM_BOT_TOKEN: Value Encrypted\n",
    probeOutput: "gatewayReachable=true\ngatewayError=none\n",
    gatewayStatusOutput: JSON.stringify({ rpc: { auth: { scopes: ["operator.read"] } } }),
    pairingOutput: JSON.stringify({ channel: "telegram", requests: [] })
  };

  assert.match(
    evaluateDoctor({ ...base, launchdStatus: { installed: false, running: false } }).rootCause,
    /not installed/
  );
  assert.match(
    evaluateDoctor({ ...base, launchdStatus: { installed: true, running: false } }).rootCause,
    /installed but not running/
  );
  assert.match(
    evaluateDoctor({
      ...base,
      launchdStatus: { installed: true, running: true },
      pairingOutput: JSON.stringify({ channel: "telegram", requests: [{ code: "123456" }] })
    }).rootCause,
    /not paired/
  );
});

test("OpenClaw Telegram doctor diagnoses missing operator scope", () => {
  const result = evaluateDoctor({
    config: {
      channels: {
        telegram: {
          enabled: true,
          botToken: { source: "env", provider: "default", id: "TELEGRAM_BOT_TOKEN" },
          dmPolicy: "pairing",
          groupPolicy: "allowlist",
          groups: {}
        }
      }
    },
    localTokenPresent: true,
    wranglerOutput: "  - TELEGRAM_BOT_TOKEN: Value Encrypted\n",
    probeOutput: "gatewayReachable=true\ngatewayError=none\n",
    launchdStatus: { installed: true, running: true },
    gatewayStatusOutput: JSON.stringify({ rpc: { auth: { scopes: [] } } }),
    pairingOutput: JSON.stringify({ channel: "telegram", requests: [] })
  });

  assert.equal(result.ok, false);
  assert.match(result.rootCause, /no operator scope/);
});

test("OpenClaw Telegram doctor returns final link when gateway is ready", () => {
  const result = evaluateDoctor({
    config: {
      channels: {
        telegram: {
          enabled: true,
          botToken: { source: "env", provider: "default", id: "TELEGRAM_BOT_TOKEN" },
          dmPolicy: "pairing",
          groupPolicy: "allowlist",
          groups: {}
        }
      }
    },
    localTokenPresent: true,
    wranglerOutput: "  - TELEGRAM_BOT_TOKEN: Value Encrypted\n",
    probeOutput: "gatewayReachable=true\ngatewayError=none\n",
    launchdStatus: { installed: true, running: true },
    gatewayStatusOutput: JSON.stringify({ rpc: { auth: { scopes: ["operator.read"] } } }),
    pairingOutput: JSON.stringify({ channel: "telegram", requests: [] })
  });

  assert.equal(result.ok, true);
  assert.equal(OPENCLAW_TELEGRAM_LINK, "https://t.me/andycodex_openclaw_bot?start=openclaw");
  assert.equal(
    formatReadyLink(),
    "Open this link:\nhttps://t.me/andycodex_openclaw_bot?start=openclaw"
  );
});

test("OpenClaw Telegram gateway status parsers read operator scope and pairing", () => {
  const gateway = inspectGatewayStatus(JSON.stringify({ rpc: { auth: { scopes: ["operator.read"] } } }));
  const pairing = inspectPairingState(JSON.stringify({ channel: "telegram", requests: [] }));

  assert.equal(gateway.operatorScopePresent, true);
  assert.equal(pairing.paired, true);
});
