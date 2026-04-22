import {
  MAX_REPORTS,
  MAX_REPORTS_DAYS,
  REPORT_ITEM_PREFIX,
  REPORTS_RECENT_STORAGE_KEY
} from "./constants.js";

const MAX_DAYS_MS = Math.max(1, MAX_REPORTS_DAYS) * 24 * 60 * 60 * 1000;
const MAX_REPORT_TEXT = 12000;

function normalizeText(rawValue, maxLength = MAX_REPORT_TEXT) {
  return String(rawValue || "").trim().slice(0, maxLength);
}

function normalizeId(rawValue, maxLength = 220) {
  return String(rawValue || "").trim().slice(0, maxLength);
}

function normalizeDate(rawValue, requiredLength = 24) {
  const value = String(rawValue || "").trim();
  return value.slice(0, requiredLength);
}

function normalizeMetricText(rawValue) {
  return normalizeText(rawValue, 80);
}

function toNumber(rawValue) {
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : null;
}

function toPercent(deltaAbs, oldValue) {
  const old = toNumber(oldValue);
  const delta = toNumber(deltaAbs);

  if (!Number.isFinite(delta) || !Number.isFinite(old) || old === 0) {
    return null;
  }

  return Number(((delta / Math.abs(old)) * 100).toFixed(4));
}

function inferTrend(oldValue, newValue) {
  const oldNum = toNumber(oldValue);
  const newNum = toNumber(newValue);

  if (!Number.isFinite(oldNum) || !Number.isFinite(newNum)) {
    return "flat";
  }

  if (newNum > oldNum) {
    return "up";
  }

  if (newNum < oldNum) {
    return "down";
  }

  return "flat";
}

function normalizeStatus(rawValue) {
  const normalized = String(rawValue || "").trim().toLowerCase();
  if (!normalized) {
    return "ok";
  }

  if (normalized === "stable" || normalized === "baseline" || normalized === "warning" || normalized === "ok") {
    return normalized;
  }

  return normalized === "error" ? "warning" : "ok";
}

function normalizeMetricChange(change) {
  if (!change || typeof change !== "object") {
    return null;
  }

  const dashboard = normalizeText(change.dashboard, 120);
  const metric = normalizeText(change.metric, 120);
  const oldValue = toNumber(change.old);
  const newValue = toNumber(change.new);

  if (!dashboard || !metric) {
    return null;
  }

  if (oldValue === null || newValue === null) {
    return null;
  }

  const old = oldValue;
  const next = newValue;
  const deltaAbs = toNumber(change.delta_abs);
  const delta = deltaAbs === null
    ? Number((next - old).toFixed(8))
    : Number(deltaAbs.toFixed(8));
  const deltaPercent = toNumber(change.delta_pct);

  return {
    dashboard,
    metric,
    old,
    new: next,
    delta_abs: delta,
    delta_pct: deltaPercent === null ? toPercent(delta, old) : deltaPercent,
    trend: normalizeTrend(change.trend || inferTrend(old, next))
  };
}

function normalizeTrend(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  if (value === "up" || value === "down" || value === "flat") {
    return value;
  }
  return value.startsWith("d") ? "down" : (value.startsWith("u") ? "up" : "flat");
}

function getReportDateFromTimestamp(timestamp) {
  const parsed = Date.parse(String(timestamp || "").trim());
  if (Number.isNaN(parsed)) {
    return "";
  }
  return new Date(parsed).toISOString().slice(0, 10);
}

function normalizeReport(input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const reportKey = normalizeText(input.report_key, 80) || "daily-dashboard-report";
  const reportDate = normalizeDate(input.report_date, 10) || getReportDateFromTimestamp(input.window_start || input.generated_at);

  if (!reportDate) {
    return null;
  }

  const generatedAt = normalizeDate(input.generated_at, 80) || new Date().toISOString();
  const reportId = normalizeId(input.report_id, 220) || `daily-report-${reportDate}`;

  return {
    report_id: reportId,
    report_key: reportKey,
    report_date: reportDate,
    window_start: normalizeDate(input.window_start || "", 80),
    window_end: normalizeDate(input.window_end || generatedAt, 80),
    source_dashboards: [...new Set(
      Array.isArray(input.source_dashboards)
        ? input.source_dashboards.map((value) => normalizeText(value, 120)).filter(Boolean)
        : []
    )],
    highlights: [...new Set(
      Array.isArray(input.highlights)
        ? input.highlights.map((value) => normalizeText(value)).filter(Boolean)
        : []
    )],
    metric_changes: [...new Set((Array.isArray(input.metric_changes) ? input.metric_changes : [])
      .map(normalizeMetricChange)
      .filter(Boolean)
      .map((change) => JSON.stringify(change))
    )].map((json) => JSON.parse(json)),
    status: normalizeStatus(input.status || ""),
    generated_at: generatedAt
  };
}

function reportDedupKey(report) {
  const reportId = normalizeId(report?.report_id, 220);
  const reportDate = normalizeDate(report?.report_date, 10);
  const reportKey = normalizeText(report?.report_key, 80);
  return reportId ? reportId : `${reportDate}:${reportKey}`;
}

function toReportTimestamp(report) {
  const parsed = Date.parse(String(report?.generated_at || "").trim());
  return Number.isNaN(parsed) ? 0 : parsed;
}

function isReportExpired(report, now = Date.now()) {
  const generated = toReportTimestamp(report);
  return !generated || (now - generated) > MAX_DAYS_MS;
}

function dedupeReports(reports) {
  const byKey = new Map();

  [...reports]
    .filter((report) => report && typeof report === "object")
    .forEach((report) => {
      const key = reportDedupKey(report);
      if (!key) {
        return;
      }

      const existing = byKey.get(key);

      if (!existing || toReportTimestamp(report) >= toReportTimestamp(existing)) {
        byKey.set(key, report);
      }
    });

  return [...byKey.values()];
}

function byReportFreshness(left, right) {
  return toReportTimestamp(right) - toReportTimestamp(left)
    || String(right.report_id || "").localeCompare(String(left.report_id || ""));
}

function uniqIds(ids, max = MAX_REPORTS) {
  return [...new Set(
    (Array.isArray(ids) ? ids : [])
      .map((id) => normalizeId(id, 220))
      .filter(Boolean)
  )].slice(-max);
}

async function readIdIndex(env, key) {
  const stored = await env.LINKS_STORE.get(key, "json");
  return uniqIds(stored, MAX_REPORTS);
}

async function writeIdIndex(env, key, ids) {
  await env.LINKS_STORE.put(key, JSON.stringify(uniqIds(ids, MAX_REPORTS)));
}

function reportItemKey(reportId) {
  return `${REPORT_ITEM_PREFIX}${normalizeId(reportId, 220)}`;
}

function isReportObject(value) {
  return value && typeof value === "object" && typeof value.report_id === "string" && value.report_id.trim();
}

async function readStoredReport(env, reportId) {
  if (!normalizeId(reportId, 220)) {
    return null;
  }
  const parsed = await env.LINKS_STORE.get(reportItemKey(reportId), "json");
  return isReportObject(parsed) ? parsed : null;
}

async function readStoredReportsByIds(env, ids) {
  const entries = await Promise.all(
    uniqIds(ids).map((id) => readStoredReport(env, id))
  );
  return entries.map(normalizeReport).filter(Boolean);
}

async function ensureReportStorageClean(env, now = Date.now()) {
  const indexedIds = await readIdIndex(env, REPORTS_RECENT_STORAGE_KEY).catch(() => []);

  if (!indexedIds.length) {
    return [];
  }

  const reports = (await readStoredReportsByIds(env, indexedIds)).filter((report) => isReportObject(report));
  const pruned = dedupeReports(reports).filter((report) => !isReportExpired(report, now));

  if (pruned.length !== reports.length) {
    await writeIdIndex(env, REPORTS_RECENT_STORAGE_KEY, pruned.map((report) => report.report_id));
  }

  return pruned.sort(byReportFreshness).slice(0, MAX_REPORTS);
}

export async function readReports(env) {
  const now = Date.now();
  const reports = await ensureReportStorageClean(env, now).catch(async () => {
    const legacy = await env.LINKS_STORE.get("reports:recent:v1", "json");
    const legacyIds = Array.isArray(legacy) ? legacy : [];
    return readStoredReportsByIds(env, legacyIds).then((value) => dedupeReports(value));
  });

  return dedupeReports(reports)
    .filter((report) => !isReportExpired(report, now))
    .sort(byReportFreshness)
    .slice(0, MAX_REPORTS);
}

export async function upsertReports(env, reports) {
  const incoming = Array.isArray(reports) ? reports : [];
  const existing = await readReports(env);
  const existingByKey = new Map();
  const existingById = new Map();

  existing.forEach((report) => {
    existingById.set(normalizeId(report.report_id, 220), report);
    existingByKey.set(reportDedupKey(report), report.report_id);
  });

  const merged = new Map(existingById);

  incoming.forEach((entry) => {
    const normalized = normalizeReport(entry);
    if (!normalized) {
      return;
    }

    const dedupeKey = reportDedupKey(normalized);
    const existingId = existingByKey.get(dedupeKey);

    if (existingId) {
      const existingReport = merged.get(existingId);
      const isIncomingFresh = toReportTimestamp(normalized) >= toReportTimestamp(existingReport);
      merged.set(existingId, isIncomingFresh ? {
        ...existingReport,
        ...normalized
      } : existingReport);
      return;
    }

    const sameId = merged.get(normalized.report_id);
    if (!sameId || toReportTimestamp(normalized) >= toReportTimestamp(sameId)) {
      merged.set(normalized.report_id, normalized);
    }
  });

  const cleaned = dedupeReports([...merged.values()])
    .sort(byReportFreshness)
    .slice(0, MAX_REPORTS);

  const ttl = Math.max(2, MAX_REPORTS_DAYS + 1) * 24 * 60 * 60;
  await Promise.all(cleaned.map((report) => env.LINKS_STORE.put(
    reportItemKey(report.report_id),
    JSON.stringify(report),
    { expirationTtl: ttl }
  )));
  await writeIdIndex(env, REPORTS_RECENT_STORAGE_KEY, cleaned.map((report) => report.report_id));

  return cleaned;
}
