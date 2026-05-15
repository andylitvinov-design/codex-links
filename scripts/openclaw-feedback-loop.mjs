#!/usr/bin/env node

const MAX_BODY_BYTES = 200 * 1024;
const DEFAULT_TIMEOUT_MS = 10000;

const PROJECTS = {
  finance: {
    key: "finance",
    label: "EzoHata Incoming Ledger",
    liveUrl: "https://ezohata-incoming-ledger.vercel.app",
    kind: "finance"
  },
  "reiki-yggdrasil": {
    key: "reiki-yggdrasil",
    label: "Reiki Yggdrasil site",
    liveUrl: "https://reiki-yggdrasil.vercel.app",
    kind: "routes",
    routes: ["/", "/profile", "/masters", "/profile/admin"]
  }
};

function normalizeBlank(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function usageError(message) {
  const error = new Error(message);
  error.code = "USAGE";
  return error;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    projectKey: null,
    expectedCommit: null,
    expectedVersion: null,
    liveUrl: null,
    json: false,
    timeoutMs: DEFAULT_TIMEOUT_MS
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      args.json = true;
      continue;
    }

    if (arg === "--project") {
      args.projectKey = normalizeBlank(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--expected-commit") {
      args.expectedCommit = normalizeBlank(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--expected-version") {
      args.expectedVersion = normalizeBlank(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--live-url") {
      args.liveUrl = normalizeBlank(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--timeout-ms") {
      const rawTimeout = normalizeBlank(argv[index + 1]);
      const timeoutMs = Number(rawTimeout);
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw usageError("--timeout-ms must be a positive number");
      }
      args.timeoutMs = Math.floor(timeoutMs);
      index += 1;
      continue;
    }

    throw usageError(`Unknown argument: ${arg}`);
  }

  if (!args.projectKey) {
    throw usageError("--project is required");
  }

  if (!PROJECTS[args.projectKey]) {
    throw usageError(`Unsupported project: ${args.projectKey}`);
  }

  return args;
}

function baseResult(args, project) {
  return {
    projectKey: project.key,
    liveUrl: args.liveUrl || project.liveUrl,
    expectedCommit: args.expectedCommit || null,
    expectedVersion: args.expectedVersion || null,
    observedCommit: null,
    observedVersion: null,
    liveReachable: false,
    versionMatches: false,
    versionVerification: "needs_verification",
    result: "needs_verification",
    exactFailingCommand: null,
    checks: [],
    risks: [],
    needsVerification: [],
    nextAction: "Run with --expected-commit or --expected-version when a live version endpoint exists."
  };
}

function joinUrl(baseUrl, path) {
  const normalizedBase = String(baseUrl || "").endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = String(path || "").replace(/^\/+/, "");
  return new URL(normalizedPath, normalizedBase).toString();
}

function shortValue(value, maxLength = 80) {
  const text = String(value ?? "").replace(/[\r\n\t]+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

async function readLimitedText(response, maxBytes = MAX_BODY_BYTES) {
  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    return text.slice(0, maxBytes);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    const remaining = maxBytes - total;
    chunks.push(chunk.length > remaining ? chunk.slice(0, remaining) : chunk);
    total += Math.min(chunk.length, remaining);

    if (chunk.length > remaining) {
      break;
    }
  }

  if (typeof reader.cancel === "function") {
    await reader.cancel().catch(() => {});
  }

  return new TextDecoder().decode(Buffer.concat(chunks));
}

function parseJson(text) {
  try {
    return { parsed: true, value: JSON.parse(text) };
  } catch {
    return { parsed: false, value: null };
  }
}

async function fetchCheck(name, url, args, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      signal: controller.signal
    });
    const body = await readLimitedText(response);
    const json = parseJson(body);

    return {
      name,
      url,
      statusCode: response.status,
      httpOk: response.ok,
      jsonParsed: json.parsed,
      data: json.value,
      error: null
    };
  } catch (error) {
    return {
      name,
      url,
      statusCode: null,
      httpOk: false,
      jsonParsed: false,
      data: null,
      error: error instanceof Error ? error.message : String(error || "fetch failed")
    };
  } finally {
    clearTimeout(timeout);
  }
}

function pushCheck(result, rawCheck, ok, summary) {
  result.checks.push({
    name: rawCheck.name,
    url: rawCheck.url,
    statusCode: rawCheck.statusCode,
    ok,
    summary
  });
}

function statusSummary(data) {
  return [
    `status=${shortValue(data?.status || "missing")}`,
    `commitSha=${shortValue(data?.commitSha || "missing")}`,
    `commitRef=${shortValue(data?.commitRef || "missing")}`,
    `googleSheetReadOk=${typeof data?.googleSheetReadOk === "boolean" ? data.googleSheetReadOk : "missing"}`
  ].join("; ");
}

function auditWarningCount(data) {
  if (Array.isArray(data?.warnings)) {
    return data.warnings.length;
  }

  if (Number.isFinite(data?.warningCount)) {
    return data.warningCount;
  }

  if (Number.isFinite(data?.summary?.warningCount)) {
    return data.summary.warningCount;
  }

  return "missing";
}

function auditSummary(rawCheck) {
  const data = rawCheck.data;
  const statusValue = data?.status ?? data?.ok ?? "missing";

  return [
    `jsonParsed=${rawCheck.jsonParsed}`,
    `status=${shortValue(statusValue)}`,
    `warningCount=${auditWarningCount(data)}`
  ].join("; ");
}

function routeSummary(rawCheck) {
  if (rawCheck.error) {
    return `reachable=false; error=${shortValue(rawCheck.error, 120)}`;
  }

  return "reachable=true; htmlPrinted=false";
}

function firstFailedCommand(result) {
  const failed = result.checks.find((check) => !check.ok);
  return failed ? `GET ${failed.url}` : null;
}

function finalizeVersion(result) {
  const needsCommit = Boolean(result.expectedCommit);
  const needsVersion = Boolean(result.expectedVersion);
  const commitMatches = needsCommit && result.expectedCommit === result.observedCommit;
  const versionMatches = needsVersion && result.expectedVersion === result.observedVersion;

  if (!needsCommit && !needsVersion) {
    result.versionMatches = false;
    result.versionVerification = "needs_verification";
    result.needsVerification.push("No expected commit or version was provided.");
    return;
  }

  if ((needsCommit && !commitMatches) || (needsVersion && !versionMatches)) {
    result.versionMatches = false;
    result.versionVerification = "fail";
    result.exactFailingCommand = result.exactFailingCommand || "compare expected commit/version with live status";
    return;
  }

  result.versionMatches = true;
  result.versionVerification = "pass";
}

function finalizeResult(result) {
  const requiredChecksPassed = result.checks.length > 0 && result.checks.every((check) => check.ok);
  result.liveReachable = result.checks.some((check) => check.ok);

  if (!requiredChecksPassed) {
    result.result = "fail";
    result.exactFailingCommand = result.exactFailingCommand || firstFailedCommand(result);
    result.nextAction = "Fix the failing live check, then rerun the verifier.";
    return result;
  }

  if (result.versionVerification === "fail") {
    result.result = "fail";
    result.nextAction = "Wait for the expected commit/version to reach live, then rerun the verifier.";
    return result;
  }

  if (result.versionVerification === "needs_verification") {
    result.result = "needs_verification";
    result.nextAction = "Add or pass a public expected commit/version signal to prove the live version.";
    return result;
  }

  result.result = "pass";
  result.nextAction = "none";
  return result;
}

async function verifyFinance(args, project, fetchImpl) {
  const result = baseResult(args, project);
  const statusUrl = joinUrl(result.liveUrl, "/api/status");
  const auditUrl = joinUrl(result.liveUrl, "/api/audit-snapshot");

  const statusCheck = await fetchCheck("api-status", statusUrl, args, fetchImpl);
  const statusOk = statusCheck.httpOk && statusCheck.jsonParsed;
  if (statusCheck.data && typeof statusCheck.data === "object") {
    result.observedCommit = normalizeBlank(statusCheck.data.commitSha);
    result.observedVersion = normalizeBlank(
      statusCheck.data.version || statusCheck.data.buildVersion || statusCheck.data.build
    );
  }
  pushCheck(
    result,
    statusCheck,
    statusOk,
    statusCheck.error ? `error=${shortValue(statusCheck.error, 120)}` : statusSummary(statusCheck.data || {})
  );

  const auditCheck = await fetchCheck("audit-snapshot", auditUrl, args, fetchImpl);
  const auditOk = auditCheck.httpOk;
  pushCheck(
    result,
    auditCheck,
    auditOk,
    auditCheck.error ? `error=${shortValue(auditCheck.error, 120)}` : auditSummary(auditCheck)
  );

  finalizeVersion(result);
  return finalizeResult(result);
}

async function verifyRoutes(args, project, fetchImpl) {
  const result = baseResult(args, project);
  result.needsVerification.push("No public commit/version endpoint exists for this project yet.");
  result.nextAction = "Add a public /version.json or /api/status endpoint, then rerun with an expected commit/version.";

  for (const route of project.routes) {
    const url = joinUrl(result.liveUrl, route);
    const check = await fetchCheck(`route:${route}`, url, args, fetchImpl);
    pushCheck(result, check, check.statusCode !== null, routeSummary(check));
  }

  result.versionMatches = false;
  result.versionVerification = "needs_verification";
  return finalizeResult(result);
}

export async function verifyFeedback(args, options = {}) {
  const project = PROJECTS[args.projectKey];
  const fetchImpl = Object.prototype.hasOwnProperty.call(options, "fetchImpl")
    ? options.fetchImpl
    : globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    const result = baseResult(args, project);
    result.needsVerification.push("Global fetch is unavailable; Node 18+ is required.");
    result.nextAction = "Run with Node 18+ or provide a runtime with global fetch.";
    return result;
  }

  if (project.kind === "finance") {
    return verifyFinance(args, project, fetchImpl);
  }

  return verifyRoutes(args, project, fetchImpl);
}

function printKeyValue(result) {
  const lines = [
    `projectKey=${result.projectKey}`,
    `liveUrl=${result.liveUrl}`,
    `result=${result.result}`,
    `observedCommit=${result.observedCommit || ""}`,
    `observedVersion=${result.observedVersion || ""}`,
    `versionMatches=${result.versionMatches}`,
    `versionVerification=${result.versionVerification}`,
    `exactFailingCommand=${result.exactFailingCommand || ""}`,
    `nextAction=${result.nextAction}`
  ];

  process.stdout.write(`${lines.join("\n")}\n`);
}

export function printResult(result, jsonMode) {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  printKeyValue(result);
}

async function main() {
  try {
    const args = parseArgs();
    const result = await verifyFeedback(args);
    printResult(result, args.json);
    process.exitCode = result.result === "fail" ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Unknown error");
    console.error(message);
    process.exitCode = 2;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
