import fs from "node:fs/promises";
import path from "node:path";
import { computeMetricChanges, extractDashboardSnapshots, buildReportPayload, formatReportDateInToronoto } from "./lib/dashboard-diff.mjs";

const defaultDir = "./dashboard-snapshots";
const endpointDefault = "https://codex-links.pages.dev";

function parseArgs() {
  const args = new Set(process.argv.slice(2).map((value) => String(value || "").trim()));
  const map = new Map();

  for (let index = 0; index < process.argv.length; index += 1) {
    const current = String(process.argv[index] || "");
    if (current.startsWith("--")) {
      const next = process.argv[index + 1];
      const normalized = current.replace(/^--/, "").trim();
      if (next && !next.startsWith("--")) {
        map.set(normalized, next);
        index += 1;
      } else {
        map.set(normalized, "true");
      }
    }
  }

  return map;
}

function readNumeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseReportDateArg(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return formatReportDateInToronoto(new Date());
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return formatReportDateInToronoto(new Date(value));
}

async function loadDashboardSnapshots(snapshotDir) {
  const targetDir = path.resolve(process.cwd(), snapshotDir);
  const items = await fs.readdir(targetDir, { withFileTypes: true });
  const files = items
    .filter((item) => item.isFile() && item.name.endsWith(".json"))
    .map((item) => path.join(targetDir, item.name))
    .sort();

  const snapshotsByDashboard = new Map();

  for (const filePath of files) {
    let parsed;
    const content = await fs.readFile(filePath, "utf8");
    try {
      parsed = JSON.parse(content);
    } catch {
      console.warn(`Пропущен невалидный JSON: ${filePath}`);
      continue;
    }

    const extracted = extractDashboardSnapshots(parsed, filePath);
    const fileTimestamp = extracted[0]?.timestamp || new Date();
    for (const entry of extracted) {
      const dashboardId = String(entry.dashboardId || "dashboard").trim();
      const now = {
        filePath,
        dashboardId,
        timestamp: entry.timestamp || fileTimestamp,
        windowStart: entry.windowStart,
        windowEnd: entry.windowEnd,
        metrics: entry.metrics || {}
      };
      const list = snapshotsByDashboard.get(dashboardId) || [];
      list.push(now);
      snapshotsByDashboard.set(dashboardId, list);
    }
  }

  return snapshotsByDashboard;
}

function toUnixDate(value) {
  const parsed = Date.parse(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickTwoLatest(entries) {
  const sorted = [...entries].sort((left, right) => toUnixDate(right.timestamp) - toUnixDate(left.timestamp));
  return sorted.slice(0, 2);
}

function buildReportFromSnapshots(snapshotsByDashboard, reportDate, reportWindowEnd) {
  const metricChanges = [];
  const sourceDashboards = [];
  let hasBaseline = false;

  for (const [dashboardId, snapshots] of snapshotsByDashboard.entries()) {
    const latestTwo = pickTwoLatest(snapshots);

    if (latestTwo.length < 2) {
      hasBaseline = true;
      sourceDashboards.push(dashboardId);
      continue;
    }

    const [previous, next] = latestTwo.reverse();
    const changes = computeMetricChanges(
      { ...previous, dashboardId },
      { ...next, dashboardId }
    );

    sourceDashboards.push(dashboardId);
    metricChanges.push(...changes);
  }

  return buildReportPayload({
    reportDate,
    windowStart: new Date(`${reportDate}T00:00:00.000Z`),
    windowEnd: reportWindowEnd,
    generatedAt: reportWindowEnd,
    sourceDashboards: [...new Set(sourceDashboards)],
    metricChanges,
    isBaseline: hasBaseline
  });
}

async function writeArtifact(report, outputDir) {
  const outDir = path.resolve(process.cwd(), outputDir);
  await fs.mkdir(outDir, { recursive: true });

  const artifactPath = path.join(outDir, `${report.report_id}.json`);
  await fs.writeFile(artifactPath, JSON.stringify(report, null, 2), "utf8");
  return artifactPath;
}

async function pushReport(apiBase, report, token, reportEndpoint = "/api/reports") {
  const response = await fetch(`${apiBase}${reportEndpoint}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-write-token": String(token || "")
    },
    body: JSON.stringify({ reports: [report] })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(`Не удалось отправить отчёт: ${String(payload?.message || response.statusText)}`);
  }
}

async function fetchLatestReport(apiBase) {
  const response = await fetch(`${apiBase}/api/reports?scope=public`, {
    cache: "no-store",
    headers: { accept: "application/json" }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(`Не удалось получить отчёты: ${String(payload?.message || response.statusText)}`);
  }

  const payload = await response.json();
  const reports = Array.isArray(payload?.reports) ? payload.reports : [];
  const latest = reports.sort((left, right) => String(right?.generated_at || "").localeCompare(String(left?.generated_at || "")))[0];
  return latest || null;
}

async function main() {
  const args = parseArgs();
  const snapshotDir = String(args.get("source") || process.env.DASHBOARD_SNAPSHOT_DIR || defaultDir);
  const outputDir = String(args.get("out") || args.get("output") || process.env.REPORTS_OUTPUT_DIR || "./artifacts/reports");
  const apiBase = String(args.get("endpoint") || args.get("api-base") || process.env.LINKS_API_BASE || endpointDefault);
  const reportDate = parseReportDateArg(args.get("date") || process.env.REPORT_DATE);
  const token = String(args.get("token") || process.env.LINKS_WRITE_TOKEN || process.env.X_WRITE_TOKEN || "");
  const checkOnly = args.get("check") === "true" || args.get("dry-run") === "true" || args.get("dry_run") === "true";
  const fetchOnly = args.get("fetch") === "true";
  const reportEndpoint = String(args.get("endpoint-reports") || "/api/reports");

  if (fetchOnly) {
    const latest = await fetchLatestReport(apiBase);
    console.log(JSON.stringify(latest, null, 2));
    return;
  }

  const snapshotsByDashboard = await loadDashboardSnapshots(snapshotDir);
  const reportWindowEnd = new Date();
  const report = buildReportFromSnapshots(snapshotsByDashboard, reportDate, reportWindowEnd);

  const artifactPath = await writeArtifact(report, outputDir);
  console.log(`Отчёт сформирован: ${artifactPath}`);
  console.log(JSON.stringify(report, null, 2));

  if (checkOnly) {
    return;
  }

  if (!token) {
    throw new Error("Нет токена для публикации отчёта. Передайте --token или LINKS_WRITE_TOKEN.");
  }

  await pushReport(apiBase, report, token, reportEndpoint);
  console.log(`Отчёт опубликован: ${apiBase}${reportEndpoint}`);
}

main().catch((error) => {
  console.error(String(error?.message || error));
  process.exitCode = 1;
});
