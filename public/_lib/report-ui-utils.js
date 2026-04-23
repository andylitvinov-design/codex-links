const MANAGEMENT_DASHBOARD_LINKS = {
  "dashboard-thinking": {
    label: "Agent 1",
    href: "https://brain-management.pages.dev/dashboard-thinking/"
  },
  "dashboard-execution-optimizer": {
    label: "Agent 2",
    href: "https://brain-management.pages.dev/dashboard-execution-optimizer/"
  },
  "dashboard-daily-changes": {
    label: "Daily Changes",
    href: "https://brain-management.pages.dev/dashboard-daily-changes/"
  }
};

function cleanText(value) {
  return String(value || "").trim();
}

export function getReportSourceLinks(sourceDashboards = []) {
  return (Array.isArray(sourceDashboards) ? sourceDashboards : [])
    .map((value) => cleanText(value))
    .filter(Boolean)
    .map((id) => {
      const known = MANAGEMENT_DASHBOARD_LINKS[id];
      return {
        id,
        label: cleanText(known?.label) || id,
        href: cleanText(known?.href)
      };
    });
}

export function getReportHighlightLines(report = {}) {
  const highlights = Array.isArray(report?.highlights)
    ? report.highlights.map((value) => cleanText(value)).filter(Boolean)
    : [];

  if (highlights.length) {
    return [...new Set(highlights)];
  }

  const summary = cleanText(report?.summary || report?.message || "");
  return summary ? [summary] : [];
}
