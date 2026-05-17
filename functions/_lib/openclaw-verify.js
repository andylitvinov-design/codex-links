const DEFAULT_TIMEOUT_MS = 10000;

const PROJECTS = {
  finance: {
    projectKey: "finance",
    liveUrl: "https://ezohata-incoming-ledger.vercel.app",
    statusPath: "/api/status",
    auditPath: "/api/audit-snapshot"
  }
};

export function parseVerifyRequest(input = {}) {
  const projectKey = String(input.project || input.projectKey || "finance").trim() || "finance";
  const project = PROJECTS[projectKey];
  if (!project) {
    return { ok: false, status: 400, error: `Unsupported project: ${projectKey}` };
  }
  const expectedCommit = String(input.expectedCommit || input.expected_commit || input.commit || "").trim();
  if (!expectedCommit) {
    return { ok: false, status: 400, error: "expectedCommit is required" };
  }
  if (!/^[0-9a-f]{7,64}$/i.test(expectedCommit)) {
    return { ok: false, status: 400, error: "expectedCommit must be a git SHA prefix/full SHA" };
  }
  const timeoutMs = Number(input.timeoutMs || input.timeout_ms || DEFAULT_TIMEOUT_MS);
  return {
    ok: true,
    project,
    expectedCommit,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(Math.floor(timeoutMs), 30000) : DEFAULT_TIMEOUT_MS
  };
}

function joinUrl(baseUrl, pathname) {
  return new URL(String(pathname || "").replace(/^\/+/, ""), String(baseUrl || "").replace(/\/+$/, "") + "/").toString();
}

function bodySnippet(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 300);
}

async function fetchCheck(name, url, { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method: "GET", signal: controller.signal });
    const text = await response.text();
    let data = null;
    let jsonParsed = false;
    let parseError = null;
    try {
      data = JSON.parse(text);
      jsonParsed = true;
    } catch (error) {
      parseError = error?.name || "ParseError";
    }
    return {
      name,
      url,
      method: "GET",
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get("content-type") || "",
      bodyFirst300: bodySnippet(text),
      jsonParsed,
      parseError,
      data
    };
  } catch (error) {
    return {
      name,
      url,
      method: "GET",
      status: null,
      ok: false,
      contentType: "",
      bodyFirst300: "",
      jsonParsed: false,
      parseError: null,
      error: error?.message || String(error || "fetch failed"),
      data: null
    };
  } finally {
    clearTimeout(timeout);
  }
}

function commitMatches(observed, expected) {
  const live = String(observed || "").trim().toLowerCase();
  const want = String(expected || "").trim().toLowerCase();
  return Boolean(live && want && (live === want || live.startsWith(want) || want.startsWith(live)));
}

function summarizeAudit(check) {
  const data = check.data || {};
  const warnings = Array.isArray(data.warnings) ? data.warnings.length : (Number.isFinite(data.warningCount) ? data.warningCount : null);
  return {
    status: data.status ?? data.ok ?? null,
    warningCount: warnings,
    jsonParsed: check.jsonParsed,
    contentType: check.contentType,
    statusCode: check.status
  };
}

export async function verifyOpenClawLive(input = {}, options = {}) {
  const parsed = parseVerifyRequest(input);
  if (!parsed.ok) {
    return { ok: false, result: "fail", error: parsed.error, status: parsed.status || 400 };
  }
  const { project, expectedCommit, timeoutMs } = parsed;
  const fetchImpl = options.fetchImpl || fetch;
  const statusCheck = await fetchCheck("api-status", joinUrl(project.liveUrl, project.statusPath), { fetchImpl, timeoutMs });
  const auditCheck = await fetchCheck("audit-snapshot", joinUrl(project.liveUrl, project.auditPath), { fetchImpl, timeoutMs });
  const observedCommit = statusCheck.data?.commitSha || null;
  const versionMatches = commitMatches(observedCommit, expectedCommit);
  const requiredOk = statusCheck.ok && statusCheck.jsonParsed && auditCheck.ok;
  const result = !requiredOk ? "fail" : versionMatches ? "pass" : "fail";
  const exactFailingCommand = !requiredOk
    ? `GET ${!statusCheck.ok || !statusCheck.jsonParsed ? statusCheck.url : auditCheck.url}`
    : versionMatches ? null : "compare expected commit with live /api/status commitSha";

  return {
    ok: result === "pass",
    result,
    projectKey: project.projectKey,
    liveUrl: project.liveUrl,
    expectedCommit,
    observedCommit,
    commitRef: statusCheck.data?.commitRef || null,
    gitRepoSlug: statusCheck.data?.gitRepoSlug || null,
    googleSheetReadOk: typeof statusCheck.data?.googleSheetReadOk === "boolean" ? statusCheck.data.googleSheetReadOk : null,
    versionMatches,
    versionVerification: versionMatches ? "pass" : "fail",
    exactFailingCommand,
    checks: [statusCheck, auditCheck].map((check) => ({
      name: check.name,
      url: check.url,
      method: check.method,
      status: check.status,
      ok: check.ok,
      contentType: check.contentType,
      jsonParsed: check.jsonParsed,
      bodyFirst300: check.jsonParsed ? "" : check.bodyFirst300,
      error: check.error || null
    })),
    audit: summarizeAudit(auditCheck),
    nextAction: result === "pass" ? "none" : "Wait for deploy or fix the failing live check, then rerun verify."
  };
}
