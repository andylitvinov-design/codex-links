import path from "node:path";

const TARGET_TIMEZONE = "America/Toronto";
const MAX_TEXT_LENGTH = 120;

function toNumberValue(rawValue) {
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : null;
}

function normalizeMetricName(value) {
  return String(value || "").trim();
}

function inferTrend(left, right) {
  if (right > left) {
    return "up";
  }

  if (right < left) {
    return "down";
  }

  return "flat";
}

function formatWindow(dateObj) {
  return dateObj instanceof Date && Number.isFinite(dateObj.getTime())
    ? dateObj.toISOString()
    : "";
}

export function formatReportDateInToronto(date = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: TARGET_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  } catch {
    return formatDateKey(date);
  }
}

export const formatReportDateInToronoto = formatReportDateInToronto;

export function formatDateKey(date = new Date()) {
  return `${date.toISOString().slice(0, 4)}-${date.toISOString().slice(5, 7)}-${date.toISOString().slice(8, 10)}`;
}

function extractNumericMetrics(source) {
  if (!source || typeof source !== "object") {
    return {};
  }

  const metrics = source.metrics && typeof source.metrics === "object" && !Array.isArray(source.metrics)
    ? source.metrics
    : source;

  return Object.entries(metrics).reduce((result, [metric, rawValue]) => {
    const metricName = normalizeMetricName(metric);
    const value = toNumberValue(rawValue);

    if (!metricName || value === null || typeof rawValue === "string" && rawValue.trim() === "") {
      return result;
    }

    if (metricName === "id" || metricName === "window_start" || metricName === "window_end" || metricName === "generated_at") {
      return result;
    }

    result[metricName] = value;
    return result;
  }, {});
}

function parseSnapshotTimestamp(snapshot = {}) {
  const candidates = [
    snapshot?.generated_at,
    snapshot?.generatedAt,
    snapshot?.window_end,
    snapshot?.windowEnd,
    snapshot?.created_at,
    snapshot?.timestamp,
    snapshot?.time
  ];

  for (const candidate of candidates) {
    const parsed = Date.parse(String(candidate || "").trim());
    if (Number.isFinite(parsed)) {
      return new Date(parsed);
    }
  }

  return null;
}

export function normalizeDashboardId(rawValue, fallbackPrefix, fallbackIndex = 0) {
  const value = String(rawValue || "").trim();
  if (value) {
    return value;
  }

  return `${fallbackPrefix}-${fallbackIndex + 1}`;
}

export function extractDashboardSnapshots(raw, sourceFile) {
  if (!raw || typeof raw !== "object") {
    return [];
  }

  const fileName = path.basename(String(sourceFile || "") || "snapshot.json");
  const timestampFromFile = fileName.match(/(\d{4}-\d{2}-\d{2})/);
  const fallbackTimestamp = timestampFromFile ? new Date(`${timestampFromFile[1]}T00:00:00.000Z`) : null;
  const timestamp = parseSnapshotTimestamp(raw) || fallbackTimestamp;
  const windowStart = parseSnapshotTimestamp(raw?.window_start || raw?.windowStart) || timestamp;
  const windowEnd = parseSnapshotTimestamp(raw?.window_end || raw?.windowEnd) || timestamp;

  const dashboardCandidates = [];

  if (Array.isArray(raw.dashboards)) {
    raw.dashboards.forEach((dashboard, index) => {
      const dashboardId = normalizeDashboardId(
        dashboard?.dashboard_id || dashboard?.dashboardId || dashboard?.id || dashboard?.slug || dashboard?.name,
        path.basename(fileName, path.extname(fileName)),
        index
      );
      const metrics = extractNumericMetrics(dashboard);

      if (Object.keys(metrics).length > 0) {
        dashboardCandidates.push({
          dashboardId,
          metrics,
          timestamp,
          windowStart: windowStart || timestamp,
          windowEnd: windowEnd || timestamp
        });
      }
    });

    return dashboardCandidates;
  }

  if (raw.dashboard && typeof raw.dashboard === "object" && !Array.isArray(raw.dashboard)) {
    const dashboardId = normalizeDashboardId(
      raw.dashboard?.id || raw.dashboard?.dashboardId || raw.dashboard?.dashboard_id || raw.dashboard?.slug || raw.dashboard?.name,
      path.basename(fileName, path.extname(fileName))
    );
    const metrics = extractNumericMetrics(raw.dashboard);

    if (Object.keys(metrics).length > 0) {
      dashboardCandidates.push({
        dashboardId,
        metrics,
        timestamp,
        windowStart: windowStart || timestamp,
        windowEnd: windowEnd || timestamp
      });
    }
    return dashboardCandidates;
  }

  const dashboardId = normalizeDashboardId(
    raw.dashboardId || raw.dashboard_id || raw.id || raw.slug || raw.name,
    path.basename(fileName, path.extname(fileName))
  );
  const metrics = extractNumericMetrics(raw.metrics || raw);

  if (Object.keys(metrics).length > 0) {
    dashboardCandidates.push({
      dashboardId,
      metrics,
      timestamp,
      windowStart: windowStart || timestamp,
      windowEnd: windowEnd || timestamp
    });
  }

  return dashboardCandidates;
}

export function computeMetricChanges(previousSnapshot, nextSnapshot) {
  const metricChanges = [];
  const previousMetrics = previousSnapshot?.metrics || {};
  const nextMetrics = nextSnapshot?.metrics || {};
  const keys = [...new Set([...Object.keys(previousMetrics), ...Object.keys(nextMetrics)])];

  keys.forEach((rawMetric) => {
    const metric = normalizeMetricName(rawMetric);
    const previousValue = toNumberValue(previousMetrics[metric]);
    const nextValue = toNumberValue(nextMetrics[metric]);

    if (metric === "" || previousValue === null || nextValue === null) {
      return;
    }

    const deltaAbs = nextValue - previousValue;
    const deltaPct = previousValue === 0
      ? null
      : Number(((deltaAbs / Math.abs(previousValue)) * 100).toFixed(4));

    metricChanges.push({
      dashboard: String(nextSnapshot.dashboardId || previousSnapshot.dashboardId),
      metric,
      old: previousValue,
      new: nextValue,
      delta_abs: Number(deltaAbs.toFixed(8)),
      delta_pct: deltaPct,
      trend: inferTrend(previousValue, nextValue)
    });
  });

  return metricChanges.sort((left, right) =>
    Math.abs(Number(right?.delta_abs || 0)) - Math.abs(Number(left?.delta_abs || 0))
  );
}

export function buildReportPayload(options = {}) {
  const reportDate = options.reportDate || formatDateKey(new Date());
  const generatedAt = formatWindow(options.generatedAt || new Date());
  const reportId = options.reportId || `daily-report-${reportDate}`;
  const hasBaseline = Boolean(options.isBaseline);
  const allChanges = [...(options.metricChanges || [])];
  const highlightedChanges = allChanges.filter((change) => Number(change?.delta_abs || 0) !== 0);

  const status = hasBaseline
    ? "baseline"
    : highlightedChanges.length
      ? "ok"
      : "stable";

  const summary = highlightedChanges.length
    ? `Updated ${highlightedChanges.length} metrics across ${options.sourceDashboards?.length || 0} dashboard(s).`
    : "No material dashboard changes";

  const highlights = highlightedChanges.length
    ? highlightedChanges.slice(0, 3).map((change) =>
      `${change.dashboard}: ${change.metric} ${change.trend === "up" ? "up" : change.trend === "down" ? "down" : "flat"}`
    )
    : ["No material dashboard changes"];

  return {
    report_id: reportId,
    report_key: "daily-dashboard-report",
    report_date: reportDate,
    window_start: formatWindow(options.windowStart || options.windowEnd || new Date(Date.now() - 24 * 60 * 60 * 1000)),
    window_end: formatWindow(options.windowEnd || options.generatedAt || new Date()),
    source_dashboards: [...new Set(options.sourceDashboards || [])],
    highlights: [...new Set(highlights.map((value) => String(value || "").slice(0, MAX_TEXT_LENGTH)))],
    metric_changes: allChanges.slice(0, 120),
    status,
    generated_at: generatedAt,
    title: `Ежедневный отчёт по dashboard: ${reportDate}`,
    summary,
    message: summary
  };
}
