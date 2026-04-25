import fs from "node:fs";
import path from "node:path";
import { validateSlackCodexActor } from "../functions/_lib/slack.js";

const ROOT = process.cwd();
const DEV_VARS_PATH = path.join(ROOT, ".dev.vars");
const PROD_URL = process.env.CODEX_LINKS_URL || "https://codex-links.pages.dev";
const CLOUD_BRIDGE_HEALTH_URL = process.env.CLOUD_BRIDGE_HEALTH_URL || "http://127.0.0.1:8788/healthz";
const IS_CI = Boolean(String(process.env.GITHUB_ACTIONS || process.env.CI || "").trim());
const REQUIRED = [
  "LINKS_WRITE_TOKEN",
  "COMMAND_DISPATCH_MODE"
];
const OPTIONAL = [
  "OPENAI_API_KEY",
  "CLOUD_BRIDGE_BASE_URL",
  "CLOUD_BRIDGE_SHARED_SECRET",
  "CLOUD_BRIDGE_LABEL",
  "CLOUD_BRIDGE_REQUEST_TIMEOUT_MS",
  "GITHUB_OWNER",
  "GITHUB_TOKEN",
  "SLACK_BOT_TOKEN",
  "SLACK_CODEX_DISPATCH_TOKEN",
  "SLACK_SIGNING_SECRET",
  "SLACK_CODEX_CHANNEL_ID",
  "SLACK_CODEX_USER_ID",
  "SLACK_ACTOR_LIVE_PROBE",
  "SLACK_ACTOR_PROBE_TIMEOUT_MS",
  "SLACK_ACTOR_PROBE_POLL_MS"
];

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const result = {};

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");

    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();

    if (key) {
      result[key] = value;
    }
  }

  return result;
}

function mask(value) {
  if (!value) {
    return "missing";
  }

  if (value.length <= 8) {
    return "set";
  }

  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

async function loadProdStatus() {
  try {
    const response = await fetch(`${PROD_URL}/api/status?_=${Date.now()}`, {
      headers: { accept: "application/json" }
    });

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    return { ok: true, status: data.status || null };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function loadJson(url) {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" }
    });

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }

    return {
      ok: true,
      body: await response.json().catch(() => null)
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function main() {
  const fileVars = parseEnvFile(DEV_VARS_PATH);
  const merged = { ...fileVars, ...process.env };

  console.log("Codex Links cloud setup check");
  console.log(`Project: ${ROOT}`);
  console.log(`Status URL: ${PROD_URL}/api/status`);
  console.log(`Bridge health URL: ${CLOUD_BRIDGE_HEALTH_URL}`);
  console.log("");

  for (const key of REQUIRED) {
    console.log(`${key}: ${mask(merged[key])}`);
  }

  console.log("");
  console.log("Optional / legacy-only:");

  for (const key of OPTIONAL) {
    console.log(`${key}: ${mask(merged[key])}`);
  }

  console.log("");

  const missing = REQUIRED.filter((key) => !String(merged[key] || "").trim());
  const configuredMode = String(merged.COMMAND_DISPATCH_MODE || "").trim().toLowerCase();
  const wantsDirectOpenAi = configuredMode === "direct-openai";
  const hasOpenAiKey = Boolean(String(merged.OPENAI_API_KEY || "").trim());
  const hasSlackRoute = Boolean(String(merged.SLACK_BOT_TOKEN || "").trim()) && Boolean(String(merged.SLACK_CODEX_CHANNEL_ID || "").trim());
  const hasTrustedBridge = Boolean(String(merged.CLOUD_BRIDGE_BASE_URL || "").trim()) && Boolean(String(merged.CLOUD_BRIDGE_SHARED_SECRET || "").trim());
  const hasCloudRoute = hasTrustedBridge || hasOpenAiKey || hasSlackRoute;

  if (wantsDirectOpenAi && !hasOpenAiKey) {
    missing.push("OPENAI_API_KEY for direct OpenAI mode");
  }

  if (!hasCloudRoute) {
    missing.push("OPENAI_API_KEY or Slack cloud route or trusted cloud bridge");
  }

  if (missing.length) {
    console.log(IS_CI ? "Missing local values (advisory in CI):" : "Missing local values:");
    for (const key of missing) {
      console.log(`- ${key}`);
    }
  } else {
    console.log("All required local values are present.");
  }

  if (!hasOpenAiKey) {
    console.log("OPENAI_API_KEY: advisory missing; direct OpenAI will be unavailable, but cloud-via-slack can still run.");
  }

  if (hasSlackRoute) {
    console.log("");
    const actorValidation = await validateSlackCodexActor(merged, {
      timeoutMs: 10_000,
      pollIntervalMs: 1_000
    }).catch((error) => ({
      validationStatus: "invalid",
      detail: error instanceof Error ? error.message : String(error)
    }));
    console.log("Local Slack actor validation:");
    console.log(`- configuredUserId: ${mask(actorValidation.configuredUserId || merged.SLACK_CODEX_USER_ID)}`);
    console.log(`- validationStatus: ${actorValidation.validationStatus || "unknown"}`);
    console.log(`- detail: ${actorValidation.detail || actorValidation.message || "none"}`);
    console.log(`- probeChannelId: ${actorValidation.probeChannelId || "none"}`);
    console.log(`- probeMessageTs: ${actorValidation.probeMessageTs || "none"}`);
    console.log(`- probeThreadTs: ${actorValidation.probeThreadTs || "none"}`);
    console.log(`- nextAction: ${actorValidation.validationStatus === "validated"
      ? "none"
      : "verify the OpenAI Codex Slack app OAuth install and set SLACK_CODEX_USER_ID to the real worker user"}`);
  }

  console.log("");

  const prod = await loadProdStatus();

  if (!prod.ok) {
    console.log(`Could not read production status: ${prod.error}`);
    process.exitCode = !IS_CI && missing.length ? 1 : 0;
    return;
  }

  const status = prod.status || {};
  const prodDispatchMode = String(status.dispatchMode || "").trim();
  const prodSlackActorStatus = String(status.slackActor?.validationStatus || "").trim();
  const prodUsesSlackRoute = prodDispatchMode === "slack-codex-cloud" || prodDispatchMode === "cloud-via-slack";
  console.log("Production status:");
  console.log(`- dispatchMode: ${status.dispatchMode || "unknown"}`);
  console.log(`- executorLabel: ${status.executorLabel || "unknown"}`);
  console.log(`- bridgeOnline: ${status.bridgeOnline ? "true" : "false"}`);
  console.log(`- slackActor: ${status.slackActor?.configuredUserId ? mask(status.slackActor.configuredUserId) : "missing"} / ${status.slackActor?.validationStatus || "unknown"}`);
  console.log(`- slackActorProbeChannelId: ${status.slackActor?.probeChannelId || "none"}`);
  console.log(`- slackActorProbeMessageTs: ${status.slackActor?.probeMessageTs || "none"}`);
  console.log(`- slackActorProbeThreadTs: ${status.slackActor?.probeThreadTs || "none"}`);
  console.log(`- state: ${status.state || "unknown"}`);
  console.log(`- lastError: ${status.lastError || "none"}`);

  if (prodUsesSlackRoute && prodSlackActorStatus !== "validated") {
    console.log("Production Slack actor is not validated.");
    console.log("Next action: verify the OpenAI Codex Slack app OAuth install and set SLACK_CODEX_USER_ID to the real worker user.");
    process.exitCode = IS_CI ? 0 : 1;
  }

  if (hasTrustedBridge) {
    console.log("");
    const bridge = await loadJson(`${CLOUD_BRIDGE_HEALTH_URL}?_=${Date.now()}`);

    if (!bridge.ok) {
      console.log(`Could not read private bridge health: ${bridge.error}`);
    } else {
      const health = bridge.body || {};
      console.log("Trusted bridge health:");
      console.log(`- ready: ${health.ready ? "true" : "false"}`);
      console.log(`- busy: ${health.busy ? "true" : "false"}`);
    }
  }

  if (missing.length && !IS_CI) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
