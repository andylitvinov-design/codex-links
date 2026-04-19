import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DEV_VARS_PATH = path.join(ROOT, ".dev.vars");
const PROD_URL = process.env.CODEX_LINKS_URL || "https://codex-links.pages.dev";
const CLOUD_BRIDGE_HEALTH_URL = process.env.CLOUD_BRIDGE_HEALTH_URL || "http://127.0.0.1:8788/healthz";
const IS_CI = Boolean(String(process.env.GITHUB_ACTIONS || process.env.CI || "").trim());
const REQUIRED = [
  "LINKS_WRITE_TOKEN",
  "COMMAND_DISPATCH_MODE",
  "CLOUD_BRIDGE_BASE_URL",
  "CLOUD_BRIDGE_SHARED_SECRET"
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

  console.log("Codex Links trusted cloud setup check");
  console.log(`Project: ${ROOT}`);
  console.log(`Pages status URL: ${PROD_URL}/api/status`);
  console.log(`Bridge health URL: ${CLOUD_BRIDGE_HEALTH_URL}`);
  console.log("");

  for (const key of REQUIRED) {
    console.log(`${key}: ${mask(merged[key])}`);
  }

  console.log("");

  const missing = REQUIRED.filter((key) => !String(merged[key] || "").trim());

  if (missing.length) {
    console.log(IS_CI ? "Missing local values (advisory in CI):" : "Missing local values:");
    for (const key of missing) {
      console.log(`- ${key}`);
    }
  } else {
    console.log("All required local values are present.");
  }

  console.log("");

  const [prodStatus, bridgeHealth] = await Promise.all([
    loadJson(`${PROD_URL}/api/status?_=${Date.now()}`),
    loadJson(`${CLOUD_BRIDGE_HEALTH_URL}?_=${Date.now()}`)
  ]);

  if (!prodStatus.ok) {
    console.log(`Could not read production status: ${prodStatus.error}`);
  } else {
    const status = prodStatus.body?.status || {};
    console.log("Production status:");
    console.log(`- dispatchMode: ${status.dispatchMode || "unknown"}`);
    console.log(`- executorLabel: ${status.executorLabel || "unknown"}`);
    console.log(`- bridgeOnline: ${status.bridgeOnline ? "true" : "false"}`);
    console.log(`- state: ${status.state || "unknown"}`);
    console.log(`- lastError: ${status.lastError || "none"}`);

    if (String(status.dispatchMode || "").trim() === "slack-codex-cloud") {
      console.log("- warning: production is still reporting legacy slack-codex-cloud, not trusted cloud.");
      process.exitCode = 1;
    }
  }

  console.log("");

  if (!bridgeHealth.ok) {
    console.log(`Could not read private bridge health: ${bridgeHealth.error}`);
  } else {
    const health = bridgeHealth.body || {};
    console.log("Private bridge health:");
    console.log(`- ready: ${health.ready ? "true" : "false"}`);
    console.log(`- busy: ${health.busy ? "true" : "false"}`);
  }

  if (missing.length && !IS_CI) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
