#!/usr/bin/env node

import { spawn } from "node:child_process";

const BASE_URL = process.env.CODEX_LINKS_URL || "https://codex-links.pages.dev";

function runStep(label, command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    console.log(`\n[delivery-smoke] ${label}`);
    const child = spawn(command, args, {
      stdio: "inherit",
      env: {
        ...process.env,
        CODEX_LINKS_URL: BASE_URL,
        ...extraEnv
      }
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      const elapsedMs = Date.now() - startedAt;

      if (code === 0) {
        console.log(`[delivery-smoke] ${label} OK in ${elapsedMs}ms`);
        resolve();
        return;
      }

      reject(new Error(`${label} failed with exit code ${code}.`));
    });
  });
}

async function fetchRouteStatus() {
  const response = await fetch(new URL("/api/status", BASE_URL), {
    headers: { accept: "application/json" }
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`Status fetch failed with HTTP ${response.status}.`);
  }

  return data?.routes || data?.status?.routes || {};
}

async function main() {
  const routes = await fetchRouteStatus();
  const directEnabled = Boolean(routes?.directOpenai?.enabled);
  const steps = [
    ["Bridge text", "node", ["scripts/smoke-bridge-delivery.mjs"]],
    ["Bridge photo", "node", ["scripts/smoke-bridge-photo-delivery.mjs"]],
    ["Cloud via Slack text", "node", ["scripts/smoke-cloud-delivery.mjs"], { CODEX_LINKS_SMOKE_CLOUD_ROUTE: "slack" }],
    ["Cloud via Slack photo", "node", ["scripts/smoke-cloud-photo-delivery.mjs"]],
    ["Claude text", "node", ["scripts/smoke-claude-delivery.mjs"]],
    ["Claude photo", "node", ["scripts/smoke-claude-photo-delivery.mjs"]]
  ];

  if (directEnabled) {
    steps.splice(4, 0, ["Direct OpenAI text", "node", ["scripts/smoke-cloud-delivery.mjs"], { CODEX_LINKS_SMOKE_CLOUD_ROUTE: "direct" }]);
  } else {
    console.log("[delivery-smoke] Direct OpenAI route is not enabled; skipping direct route smoke.");
  }

  for (const [label, command, args, env] of steps) {
    await runStep(label, command, args, env);
  }

  console.log("\n[delivery-smoke] Delivery smoke matrix passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
