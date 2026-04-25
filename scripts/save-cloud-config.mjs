import fs from "node:fs";

const DEFAULT_URL = "https://codex-links.pages.dev";
const ENV_PATH = process.env.ENV_FILE || ".dev.vars";

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${filePath}`);
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

async function main() {
  const fileVars = parseEnvFile(ENV_PATH);
  const env = { ...fileVars, ...process.env };
  const baseUrl = String(env.CODEX_LINKS_URL || DEFAULT_URL).trim();
  const writeToken = String(env.LINKS_WRITE_TOKEN || "").trim();

  if (!writeToken) {
    throw new Error("Missing LINKS_WRITE_TOKEN.");
  }

  const config = {
    COMMAND_DISPATCH_MODE: env.COMMAND_DISPATCH_MODE || "",
    CLOUD_BRIDGE_BASE_URL: env.CLOUD_BRIDGE_BASE_URL || "",
    CLOUD_BRIDGE_REQUEST_TIMEOUT_MS: env.CLOUD_BRIDGE_REQUEST_TIMEOUT_MS || "",
    CLOUD_BRIDGE_LABEL: env.CLOUD_BRIDGE_LABEL || "",
    GITHUB_OWNER: env.GITHUB_OWNER || "",
    GITHUB_TOKEN: env.GITHUB_TOKEN || "",
    SLACK_BOT_TOKEN: env.SLACK_BOT_TOKEN || "",
    SLACK_SIGNING_SECRET: env.SLACK_SIGNING_SECRET || "",
    SLACK_CODEX_CHANNEL_ID: env.SLACK_CODEX_CHANNEL_ID || "",
    SLACK_CODEX_USER_ID: env.SLACK_CODEX_USER_ID || "",
    SLACK_CODEX_MENTION: env.SLACK_CODEX_MENTION || "",
    SLACK_ACTOR_ACTIVITY_FRESHNESS_MS: env.SLACK_ACTOR_ACTIVITY_FRESHNESS_MS || "",
    SLACK_ACTOR_PROBE_COOLDOWN_MS: env.SLACK_ACTOR_PROBE_COOLDOWN_MS || ""
  };

  const response = await fetch(`${baseUrl}/api/config`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-write-token": writeToken
    },
    body: JSON.stringify({ config })
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Config upload failed: ${response.status} ${body}`);
  }

  console.log(body);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
