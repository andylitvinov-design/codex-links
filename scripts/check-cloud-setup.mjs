import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DEV_VARS_PATH = path.join(ROOT, ".dev.vars");
const PROD_URL = process.env.CODEX_LINKS_URL || "https://codex-links.pages.dev";
const REQUIRED = [
  "LINKS_WRITE_TOKEN",
  "COMMAND_DISPATCH_MODE",
  "GITHUB_OWNER",
  "GITHUB_TOKEN",
  "SLACK_BOT_TOKEN",
  "SLACK_SIGNING_SECRET",
  "SLACK_CODEX_CHANNEL_ID",
  "SLACK_CODEX_USER_ID"
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

async function callSlackApi(token, method, query = null) {
  const url = new URL(`https://slack.com/api/${method}`);

  if (query && typeof query === "object") {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim()) {
        url.searchParams.set(key, String(value));
      }
    });
  }

  const response = await fetch(url.toString(), {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json"
    }
  });
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || `Slack API ${method} failed with ${response.status}`);
  }

  return data;
}

async function loadSlackValidation(env) {
  const token = String(env.SLACK_BOT_TOKEN || "").trim();
  const channel = String(env.SLACK_CODEX_CHANNEL_ID || "").trim();
  const target = String(env.SLACK_CODEX_USER_ID || "").trim();

  if (!token || !channel || !target) {
    return { ok: false, error: "Missing Slack validation inputs." };
  }

  try {
    const [auth, members] = await Promise.all([
      callSlackApi(token, "auth.test"),
      callSlackApi(token, "conversations.members", { channel })
    ]);
    const botUserId = String(auth.user_id || "").trim();
    const memberIds = Array.isArray(members.members) ? members.members.map((value) => String(value || "").trim()) : [];

    return {
      ok: true,
      botUserId,
      target,
      targetIsBot: Boolean(botUserId) && botUserId === target,
      targetInChannel: memberIds.includes(target),
      memberCount: memberIds.length
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
  console.log("");

  for (const key of REQUIRED) {
    console.log(`${key}: ${mask(merged[key])}`);
  }

  console.log("");

  const missing = REQUIRED.filter((key) => !String(merged[key] || "").trim());

  if (missing.length) {
    console.log("Missing local values:");
    for (const key of missing) {
      console.log(`- ${key}`);
    }
  } else {
    console.log("All required local values are present.");
  }

  console.log("");

  const prod = await loadProdStatus();
  const slackValidation = await loadSlackValidation(merged);

  if (!prod.ok) {
    console.log(`Could not read production status: ${prod.error}`);
    process.exitCode = missing.length ? 1 : 0;
    return;
  }

  const status = prod.status || {};
  console.log("Production status:");
  console.log(`- dispatchMode: ${status.dispatchMode || "unknown"}`);
  console.log(`- executorLabel: ${status.executorLabel || "unknown"}`);
  console.log(`- bridgeOnline: ${status.bridgeOnline ? "true" : "false"}`);
  console.log(`- state: ${status.state || "unknown"}`);
  console.log(`- lastError: ${status.lastError || "none"}`);

  console.log("");
  console.log("Slack dispatch validation:");

  if (!slackValidation.ok) {
    console.log(`- error: ${slackValidation.error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`- botUserId: ${mask(slackValidation.botUserId)}`);
  console.log(`- configuredTarget: ${mask(slackValidation.target)}`);
  console.log(`- targetIsBot: ${slackValidation.targetIsBot ? "true" : "false"}`);
  console.log(`- targetInChannel: ${slackValidation.targetInChannel ? "true" : "false"}`);
  console.log(`- memberCount: ${slackValidation.memberCount}`);

  if (status.dispatchMode !== "slack-codex-cloud") {
    process.exitCode = 1;
  }

  if (slackValidation.targetIsBot || !slackValidation.targetInChannel) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
