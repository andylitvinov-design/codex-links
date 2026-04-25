#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { withCodexAppServer } from "./codex-app-rpc.mjs";
import { evaluateCloudDeliveryCommand } from "./_lib/cloud-guardian.mjs";

const DEFAULT_BASE_URL = "https://codex-links.pages.dev";
const REPORT_STATE_PATH = path.join(os.homedir(), ".codex-links", "cloud-reports-thread.json");

function normalizeText(value) {
  return String(value || "").trim();
}

function execFileJson(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(normalizeText(stderr) || error.message));
        return;
      }

      try {
        resolve(JSON.parse(stdout || "{}"));
      } catch (parseError) {
        reject(parseError);
      }
    });
  });
}

function parsePrUrl(value) {
  const match = normalizeText(value).match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/i);
  return match ? { repo: match[1], number: match[2], url: match[0] } : null;
}

async function fetchCommands(baseUrl, writeToken) {
  const response = await fetch(new URL("/api/commands?scope=recent", baseUrl), {
    headers: {
      accept: "application/json",
      "x-write-token": writeToken
    }
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(normalizeText(data?.error) || `Command fetch failed with HTTP ${response.status}.`);
  }

  return Array.isArray(data?.commands) ? data.commands : [];
}

async function updateCommand(baseUrl, writeToken, update) {
  if (!update?.id) {
    return null;
  }

  const response = await fetch(new URL("/api/commands", baseUrl), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-write-token": writeToken
    },
    body: JSON.stringify({
      action: update.action || "delivery-update",
      ...update
    })
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(normalizeText(data?.error) || `Command update failed with HTTP ${response.status}.`);
  }

  return data?.command || null;
}

async function fetchPrFacts(command) {
  const parsed = parsePrUrl(command?.prUrl);

  if (!parsed) {
    return {};
  }

  const data = await execFileJson("gh", [
    "pr",
    "view",
    parsed.number,
    "--repo",
    parsed.repo,
    "--json",
    "url,headRefName,merged,mergeCommit"
  ]);

  return {
    url: data.url || parsed.url,
    branchName: data.headRefName || "",
    merged: Boolean(data.merged),
    mergeCommit: normalizeText(data.mergeCommit?.oid || data.mergeCommit?.abbreviatedOid || "")
  };
}

async function fetchSmokeFacts(command) {
  const productionUrl = normalizeText(command?.productionUrl || command?.deploy?.productionUrl);

  if (!productionUrl) {
    return { ok: false, error: "Missing production URL.", url: "" };
  }

  const smokePath = normalizeText(command?.deploy?.smokePath) || "/";
  const url = new URL(smokePath, productionUrl);
  const response = await fetch(url, {
    headers: { accept: "text/html,application/json;q=0.9,*/*;q=0.8" },
    signal: AbortSignal.timeout(15_000)
  }).catch((error) => ({ ok: false, status: 0, error }));

  if (!response.ok) {
    return {
      ok: false,
      url: url.toString(),
      error: response.error instanceof Error ? response.error.message : `Smoke returned HTTP ${response.status}.`
    };
  }

  return {
    ok: true,
    url: url.toString()
  };
}

async function readReportThreadId() {
  const raw = await readFile(REPORT_STATE_PATH, "utf8").catch(() => "");
  const data = raw ? JSON.parse(raw) : {};
  return normalizeText(data.threadId);
}

async function writeReportThreadId(threadId) {
  await mkdir(path.dirname(REPORT_STATE_PATH), { recursive: true });
  await writeFile(REPORT_STATE_PATH, JSON.stringify({
    threadId,
    updatedAt: new Date().toISOString()
  }, null, 2));
}

async function mirrorReportToDesktop(report) {
  if (!normalizeText(report)) {
    return "";
  }

  return withCodexAppServer(async ({ request }) => {
    let threadId = await readReportThreadId();
    const input = [
      "Record this Codex Links cloud delivery report. Reply with ACK only.",
      "",
      report
    ].join("\n");

    if (!threadId) {
      const started = await request("thread/start", {
        input
      });
      threadId = normalizeText(started?.thread?.id);

      if (!threadId) {
        throw new Error("thread/start did not return a report thread id.");
      }

      await request("thread/name/set", {
        threadId,
        name: "Codex Links Cloud Reports"
      }).catch(() => {});
      await writeReportThreadId(threadId);
      return threadId;
    }

    await request("thread/resume", { threadId }).catch(() => {});
    await request("turn/start", {
      threadId,
      input
    });
    return threadId;
  });
}

function shouldInspectCommand(command) {
  const deliveryStatus = normalizeText(command?.deliveryStatus).toLowerCase();

  return Boolean(command?.productionVerifiable || command?.deploy?.productionUrl)
    && (command?.dispatchMode === "slack-codex-cloud" || command?.dispatchMode === "cloud")
    && deliveryStatus !== "production-verified"
    && deliveryStatus !== "mirrored"
    && deliveryStatus !== "blocked";
}

async function main() {
  const baseUrl = normalizeText(process.env.LINKS_BASE_URL || process.env.CODEX_LINKS_URL) || DEFAULT_BASE_URL;
  const writeToken = normalizeText(process.env.LINKS_WRITE_TOKEN);

  if (!writeToken) {
    throw new Error("Set LINKS_WRITE_TOKEN before running cloud guardian.");
  }

  const commands = (await fetchCommands(baseUrl, writeToken)).filter(shouldInspectCommand);
  const changed = [];

  for (const command of commands) {
    const pr = await fetchPrFacts(command).catch((error) => ({ error: error.message }));
    const smoke = pr?.merged ? await fetchSmokeFacts(command) : {};
    const decision = evaluateCloudDeliveryCommand(command, { pr, smoke });

    if (decision.action === "none" || !decision.update) {
      continue;
    }

    const updated = await updateCommand(baseUrl, writeToken, {
      ...(decision.update || {}),
      action: decision.action === "fallback" ? "fallback-local" : "delivery-update"
    });
    let mirrorThreadId = "";

    if (decision.report) {
      mirrorThreadId = await mirrorReportToDesktop(decision.report).catch((error) => {
        console.error(`Desktop mirror failed for ${command.id}: ${error.message}`);
        return "";
      });

      if (mirrorThreadId) {
        await updateCommand(baseUrl, writeToken, {
          id: command.id,
          status: updated?.status || command.status,
          progressStage: updated?.progressStage || command.progressStage,
          desktopMirrorStatus: "mirrored",
          desktopMirroredAt: new Date().toISOString(),
          desktopMirrorThreadId: mirrorThreadId
        });
      }
    }

    changed.push({
      id: command.id,
      action: decision.action,
      deliveryStatus: decision.update.deliveryStatus,
      mirrored: Boolean(mirrorThreadId)
    });
  }

  console.log(JSON.stringify({
    ok: true,
    inspected: commands.length,
    changed
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
