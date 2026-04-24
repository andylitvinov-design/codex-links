import fs from "node:fs/promises";
import path from "node:path";

const LINKS_ROOT = "/Users/andriilitvinov/projects/MYPROJECTS/links";
const DEFAULT_MANAGEMENT_DATA_ROOT = "/Users/andriilitvinov/projects/brain/management/dashboard-thinking/data";
const DEFAULT_API_BASE = "https://codex-links.pages.dev";
const DEV_VARS_PATH = path.join(LINKS_ROOT, ".dev.vars");
const DEFAULT_TIMEZONE = "America/Toronto";

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

function getLocalDateInTimezone(value, timezone = DEFAULT_TIMEZONE) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));

  return `${parts.year}-${parts.month}-${parts.day}`;
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
  const dataRoot = nonEmpty(args.get("data-root") || process.env.MANAGEMENT_DATA_ROOT) || DEFAULT_MANAGEMENT_DATA_ROOT;
  const timezone = nonEmpty(args.get("timezone") || process.env.BRAIN_MANAGEMENT_TIMEZONE) || DEFAULT_TIMEZONE;
  const today = getLocalDateInTimezone(process.env.BRAIN_MANAGEMENT_NOW || Date.now(), timezone);
  const reportDateOverride = nonEmpty(args.get("date"));
  const checkOnly = args.get("dry-run") === "true" || args.get("check") === "true";
  const allowDateOverride = args.get("allow-date-override") === "true";
  const allowStaleSourceDate = args.get("allow-stale-source-date") === "true";

  if (!token && !checkOnly) {
    throw new Error("Missing LINKS_WRITE_TOKEN.");
  }

  const thinking = await readJson(path.join(dataRoot, "current-thinking-audit.json"));
  const upgrade = await readJson(path.join(dataRoot, "current-daily-upgrade.json"));
  const dailyChanges = await readJson(path.join(dataRoot, "current-daily-changes.json"));
  const thinkingHistory = await readJson(path.join(dataRoot, "thinking-history.json")).catch(() => []);
  const upgradeHistory = await readJson(path.join(dataRoot, "daily-upgrade-history.json")).catch(() => []);
  const dailyChangesHistory = await readJson(path.join(dataRoot, "daily-changes-history.json")).catch(() => []);

  const reportDate = reportDateOverride || nonEmpty(thinking?.meta?.day || upgrade?.meta?.day || dailyChanges?.meta?.day);
  if (!reportDate) {
    throw new Error("Unable to determine report date.");
  }

  if (!today) {
    throw new Error(`Unable to determine current date for timezone ${timezone}.`);
  }

  if (reportDate !== today && !allowDateOverride) {
    throw new Error(`Refusing to publish report_date ${reportDate}; today in ${timezone} is ${today}. Use --allow-date-override for an explicit backfill.`);
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

  const staleParts = parts.filter((part) => !part.dayMatches);
  if (staleParts.length && !allowStaleSourceDate) {
    const detail = staleParts.map((part) => `${part.dashboard}=${part.day || "missing"}`).join(", ");
    throw new Error(`Refusing to publish stale management report ${reportDate}; source dates do not match: ${detail}. Refresh dashboards first or use --allow-stale-source-date for an explicit diagnostic publish.`);
  }

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
