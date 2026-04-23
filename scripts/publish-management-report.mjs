import fs from "node:fs/promises";
import path from "node:path";

const LINKS_ROOT = "/Users/andriilitvinov/projects/MYPROJECTS/links";
const MANAGEMENT_DATA_ROOT = "/Users/andriilitvinov/projects/brain/management/dashboard-thinking/data";
const DEFAULT_API_BASE = "https://codex-links.pages.dev";
const DEV_VARS_PATH = path.join(LINKS_ROOT, ".dev.vars");

function parseArgs() {
  const map = new Map();
  for (let index = 2; index < process.argv.length; index += 1) {
    const current = String(process.argv[index] || "").trim();
    if (!current.startsWith("--")) continue;
    const key = current.slice(2);
    const next = String(process.argv[index + 1] || "");
    if (next && !next.startsWith("--")) {
      map.set(key, next);
      index += 1;
    } else {
      map.set(key, "true");
    }
  }
  return map;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readDevVars(filePath) {
  try {
    const body = await fs.readFile(filePath, "utf8");
    return body.split("\n").reduce((result, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return result;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex <= 0) return result;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      result[key] = value.replace(/^['"]|['"]$/g, "");
      return result;
    }, {});
  } catch {
    return {};
  }
}

function parseIso(value) {
  const text = String(value || "").trim();
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function nonEmpty(value) {
  return String(value || "").trim();
}

function compactText(value, max = 180) {
  const text = nonEmpty(value).replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function statusFromParts(parts) {
  return parts.every((part) => part.dayMatches) ? "ok" : "warning";
}

function buildMetricChanges(thinking, upgrade, dailyChanges, previousThinking, previousUpgrade, previousDailyChanges) {
  const changes = [];
  const candidates = [
    {
      dashboard: "dashboard-thinking",
      metric: "overallScore",
      previous: previousThinking?.meta?.overallScore,
      next: thinking?.meta?.overallScore
    },
    {
      dashboard: "dashboard-thinking",
      metric: "loopHealth",
      previous: previousThinking?.meta?.loopHealth,
      next: thinking?.meta?.loopHealth
    },
    {
      dashboard: "dashboard-execution-optimizer",
      metric: "systemUpgrades",
      previous: Array.isArray(previousUpgrade?.systemUpgrades) ? previousUpgrade.systemUpgrades.length : null,
      next: Array.isArray(upgrade?.systemUpgrades) ? upgrade.systemUpgrades.length : null
    },
    {
      dashboard: "dashboard-daily-changes",
      metric: "topUpgrades",
      previous: Array.isArray(previousDailyChanges?.topUpgrades) ? previousDailyChanges.topUpgrades.length : null,
      next: Array.isArray(dailyChanges?.topUpgrades) ? dailyChanges.topUpgrades.length : null
    }
  ];

  for (const item of candidates) {
    const oldValue = Number(item.previous);
    const newValue = Number(item.next);
    if (!Number.isFinite(oldValue) || !Number.isFinite(newValue)) continue;
    const deltaAbs = Number((newValue - oldValue).toFixed(4));
    const deltaPct = oldValue === 0 ? null : Number((((newValue - oldValue) / Math.abs(oldValue)) * 100).toFixed(4));
    changes.push({
      dashboard: item.dashboard,
      metric: item.metric,
      old: oldValue,
      new: newValue,
      delta_abs: deltaAbs,
      delta_pct: deltaPct,
      trend: newValue > oldValue ? "up" : newValue < oldValue ? "down" : "flat"
    });
  }

  return changes;
}

async function main() {
  const args = parseArgs();
  const devVars = await readDevVars(DEV_VARS_PATH);
  const apiBase = nonEmpty(args.get("api-base") || process.env.LINKS_API_BASE || devVars.LINKS_BASE_URL) || DEFAULT_API_BASE;
  const token = nonEmpty(args.get("token") || process.env.LINKS_WRITE_TOKEN || devVars.LINKS_WRITE_TOKEN);
  const reportDateOverride = nonEmpty(args.get("date"));
  const checkOnly = args.get("dry-run") === "true" || args.get("check") === "true";

  if (!token && !checkOnly) {
    throw new Error("Missing LINKS_WRITE_TOKEN.");
  }

  const thinking = await readJson(path.join(MANAGEMENT_DATA_ROOT, "current-thinking-audit.json"));
  const upgrade = await readJson(path.join(MANAGEMENT_DATA_ROOT, "current-daily-upgrade.json"));
  const dailyChanges = await readJson(path.join(MANAGEMENT_DATA_ROOT, "current-daily-changes.json"));
  const thinkingHistory = await readJson(path.join(MANAGEMENT_DATA_ROOT, "thinking-history.json")).catch(() => []);
  const upgradeHistory = await readJson(path.join(MANAGEMENT_DATA_ROOT, "daily-upgrade-history.json")).catch(() => []);
  const dailyChangesHistory = await readJson(path.join(MANAGEMENT_DATA_ROOT, "daily-changes-history.json")).catch(() => []);

  const reportDate = reportDateOverride || nonEmpty(thinking?.meta?.day || upgrade?.meta?.day || dailyChanges?.meta?.day);
  if (!reportDate) {
    throw new Error("Unable to determine report date.");
  }

  const generatedAt = parseIso(
    thinking?.meta?.lastAuditTime
      || upgrade?.meta?.generatedAt
      || dailyChanges?.meta?.generatedAt
      || new Date().toISOString()
  ) || new Date().toISOString();

  const previousThinking = Array.isArray(thinkingHistory) ? thinkingHistory.at(-2) : null;
  const previousUpgrade = Array.isArray(upgradeHistory) ? upgradeHistory.at(-2) : null;
  const previousDailyChanges = Array.isArray(dailyChangesHistory) ? dailyChangesHistory.at(-2) : null;

  const parts = [
    { dashboard: "dashboard-thinking", day: nonEmpty(thinking?.meta?.day), dayMatches: nonEmpty(thinking?.meta?.day) === reportDate },
    { dashboard: "dashboard-execution-optimizer", day: nonEmpty(upgrade?.meta?.day), dayMatches: nonEmpty(upgrade?.meta?.day) === reportDate },
    { dashboard: "dashboard-daily-changes", day: nonEmpty(dailyChanges?.meta?.day), dayMatches: nonEmpty(dailyChanges?.meta?.day) === reportDate }
  ];

  const agent1Focus = compactText(thinking?.meta?.summary || thinking?.priorityRecommendations?.[0]?.title || "");
  const agent2Action = compactText(
    upgrade?.projectImpact?.[0]?.nextBestAction
      || upgrade?.topActions?.[0]?.action
      || upgrade?.summary?.headline
      || ""
  );
  const dailyChangesTop = compactText(
    dailyChanges?.topUpgrades?.[0]?.title
      || dailyChanges?.summary?.focus
      || dailyChanges?.nextRecommendations?.[0]?.detail
      || ""
  );

  const highlights = [
    `Agent 1: ${agent1Focus || "no focus found"}`,
    `Agent 2: ${agent2Action || "no action found"}`,
    `Daily Changes: ${dailyChangesTop || "no item found"}`
  ];

  const metricChanges = buildMetricChanges(
    thinking,
    upgrade,
    dailyChanges,
    previousThinking,
    previousUpgrade,
    previousDailyChanges
  );

  const report = {
    report_id: `management-morning-report-${reportDate}`,
    report_key: "management-morning-report",
    report_date: reportDate,
    window_start: `${reportDate}T00:00:00.000Z`,
    window_end: generatedAt,
    source_dashboards: parts.map((part) => part.dashboard),
    highlights,
    metric_changes: metricChanges,
    status: statusFromParts(parts),
    generated_at: generatedAt,
    title: `Management Morning Report (${reportDate})`,
    summary: `Agent 1: ${agent1Focus || "n/a"}; Agent 2: ${agent2Action || "n/a"}; Daily Changes: ${dailyChangesTop || "n/a"}.`
  };

  console.log(JSON.stringify(report, null, 2));

  if (checkOnly) {
    return;
  }

  const response = await fetch(`${apiBase}/api/reports`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-write-token": token
    },
    body: JSON.stringify({ reports: [report] })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Report publish failed: ${response.status} ${body}`);
  }

  const payload = await response.json();
  const published = Array.isArray(payload?.reports) ? payload.reports.find((item) => item?.report_id === report.report_id) : null;
  if (!published) {
    throw new Error("Report publish returned no matching report.");
  }

  console.log(`Published ${report.report_id} to ${apiBase}/api/reports`);
}

main().catch((error) => {
  console.error(String(error?.message || error));
  process.exit(1);
});
