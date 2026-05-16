#!/usr/bin/env node

const MAX_BODY_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 10000;

const PROJECTS = {
  finance: {
    projectKey: "finance",
    label: "EzoHata Ledger",
    liveUrl: "https://ezohata-incoming-ledger.vercel.app",
    statusPath: "/api/status",
    auditPath: "/api/audit-snapshot"
  },
  "reiki-yggdrasil": {
    projectKey: "reiki-yggdrasil",
    label: "Reiki Yggdrasil",
    liveUrl: "https://reiki-yggdrasil.vercel.app",
    paths: ["/", "/profile", "/masters", "/profile/admin"]
  }
};

function parseArgs(argv) {
  const args = {
    project: "finance",
    expectedCommit: null,
    liveUrl: null,
    json: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      args.json = true;
      continue;
    }

    if (arg === "--project") {
      args.project = argv[index + 1] || "";
      index += 1;
      continue;
    }

    if (arg === "--expected-commit") {
      args.expectedCommit = argv[index + 1] || "";
      index += 1;
      continue;
    }

    if (arg === "--live-url") {
      args.liveUrl = argv[index + 1] || "";
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function normalizeBaseUrl(rawUrl) {
  const url = new URL(rawUrl);
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function buildUrl(baseUrl, path) {
  return new URL(path, `${baseUrl}/`).toString();
}

function sanitizeError(error) {
  const message = error instanceof Error ? error.message : String(error || "unknown error");
  return message.replace(/https?:\/\/[^\s]+/g, "[url]").slice(0, 240);
}

async function readLimitedText(response, maxBytes = MAX_BODY_BYTES) {
  const reader = response.body?.getReader();

  if (!reader) {
    return "";
  }

  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    total += value.byteLength;

    if (total > maxBytes) {
      const allowed = value.byteLength - (total - maxBytes);
      if (allowed > 0) {
        chunks.push(value.slice(0, allowed));
      }
      break;
    }

    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function fetchSummary(url, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const started = Date.now();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: options.accept || "application/json, text/plain;q=0.8, */*;q=0.5",
        "user-agent": "codex-links-openclaw-feedback-loop/1.0"
      }
    });
    const text = await readLimitedText(response, options.maxBytes || MAX_BODY_BYTES);
    const contentType = response.headers.get("content-type") || "";
    return {
      ok: response.ok,
      statusCode: response.status,
      durationMs: Date.now() - started,
      contentType,
      text
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: null,
      durationMs: Date.now() - started,
      error: sanitizeError(error),
      text: ""
    };
  } finally {
    clearTimeout(timeout);
  }
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function pickFirstString(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function countWarnings(data) {
  if (!data || typeof data !== "object") {
    return "needs_verification";
  }

  if (Array.isArray(data.warnings)) {
    return data.warnings.length;
  }

  if (Array.isArray(data.warningList)) {
    return data.warningList.length;
  }

  if (data.summary && Number.isFinite(data.summary.warningCount)) {
    return data.summary.warningCount;
  }

  if (Number.isFinite(data.warningCount)) {
    return data.warningCount;
  }

  return "needs_verification";
}

function commitsMatch(expected, observed) {
  if (!expected || !observed || observed === "needs_verification") {
    return "needs_verification";
  }

  const normalizedExpected = expected.trim().toLowerCase();
  const normalizedObserved = observed.trim().toLowerCase();

  return normalizedExpected === normalizedObserved
    || normalizedExpected.startsWith(normalizedObserved)
    || normalizedObserved.startsWith(normalizedExpected);
}

async function verifyFinance(config, args) {
  const liveUrl = normalizeBaseUrl(args.liveUrl || config.liveUrl);
  const statusEndpoint = buildUrl(liveUrl, config.statusPath);
  const auditEndpoint = buildUrl(liveUrl, config.auditPath);
  const checks = [];

  const statusResponse = await fetchSummary(statusEndpoint);
  const statusJson = tryParseJson(statusResponse.text);
  const observedCommit = pickFirstString(statusJson, ["commitSha", "commitRef", "version", "build"]) || "needs_verification";
  const statusValue = pickFirstString(statusJson, ["status"]) || "needs_verification";

  checks.push({
    name: "status",
    command: `GET ${config.statusPath}`,
    ok: statusResponse.ok,
    statusCode: statusResponse.statusCode,
    status: statusValue,
    commitSha: pickFirstString(statusJson, ["commitSha"]) || null,
    commitRef: pickFirstString(statusJson, ["commitRef"]) || null,
    durationMs: statusResponse.durationMs,
    error: statusResponse.error || null
  });

  const auditResponse = await fetchSummary(auditEndpoint, { maxBytes: MAX_BODY_BYTES });
  const auditJson = tryParseJson(auditResponse.text);

  checks.push({
    name: "audit-snapshot",
    command: `GET ${config.auditPath}`,
    ok: auditResponse.ok,
    statusCode: auditResponse.statusCode,
    warningCount: countWarnings(auditJson),
    durationMs: auditResponse.durationMs,
    error: auditResponse.error || null
  });

  const liveReachable = checks.some((check) => check.ok);
  const endpointFailure = checks.find((check) => !check.ok);
  const versionMatches = commitsMatch(args.expectedCommit, observedCommit);
  let result = "needs_verification";
  let summary = "Finance live endpoints are reachable, but no expected commit was provided for a version claim.";

  if (endpointFailure) {
    result = "fail";
    summary = `Finance verification failed at ${endpointFailure.command}.`;
  } else if (args.expectedCommit && versionMatches === true) {
    result = "pass";
    summary = "Finance live status commit matches expected commit and audit snapshot is reachable.";
  } else if (args.expectedCommit && versionMatches !== true) {
    result = "fail";
    summary = "Finance live status commit does not match expected commit.";
  }

  return {
    projectKey: config.projectKey,
    liveUrl,
    expectedCommit: args.expectedCommit || null,
    observedCommit,
    statusEndpoint,
    liveReachable,
    versionMatches,
    checks,
    result,
    exactFailingCommand: endpointFailure?.command || (result === "fail" && args.expectedCommit ? `GET ${config.statusPath}` : null),
    summary
  };
}

async function verifyReiki(config, args) {
  const liveUrl = normalizeBaseUrl(args.liveUrl || config.liveUrl);
  const checks = [];

  for (const path of config.paths) {
    const response = await fetchSummary(buildUrl(liveUrl, path), {
      accept: "text/html, */*;q=0.5",
      maxBytes: 64 * 1024
    });

    checks.push({
      name: path,
      command: `GET ${path}`,
      ok: response.ok,
      statusCode: response.statusCode,
      durationMs: response.durationMs,
      error: response.error || null
    });
  }

  const liveReachable = checks.some((check) => check.ok);
  const endpointFailure = checks.find((check) => !check.ok);

  return {
    projectKey: config.projectKey,
    liveUrl,
    expectedCommit: args.expectedCommit || null,
    observedCommit: "needs_verification",
    statusEndpoint: null,
    liveReachable,
    versionMatches: "needs_verification",
    checks,
    result: endpointFailure ? "fail" : "needs_verification",
    exactFailingCommand: endpointFailure?.command || null,
    summary: endpointFailure
      ? `Reiki Yggdrasil verification failed at ${endpointFailure.command}.`
      : "Reiki Yggdrasil routes are reachable, but no public build version endpoint is known. Add /version.json or a status endpoint for commit verification."
  };
}

function printText(result) {
  const lines = [
    `projectKey=${result.projectKey}`,
    `liveUrl=${result.liveUrl}`,
    `expectedCommit=${result.expectedCommit || "none"}`,
    `observedCommit=${result.observedCommit || "needs_verification"}`,
    `statusEndpoint=${result.statusEndpoint || "none"}`,
    `liveReachable=${result.liveReachable}`,
    `versionMatches=${result.versionMatches}`,
    `result=${result.result}`,
    `exactFailingCommand=${result.exactFailingCommand || "none"}`,
    `summary=${result.summary}`
  ];

  for (const check of result.checks) {
    lines.push(`check=${check.name} ok=${check.ok} statusCode=${check.statusCode ?? "none"} durationMs=${check.durationMs}`);
  }

  console.log(lines.join("\n"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = PROJECTS[args.project];

  if (!config) {
    throw new Error(`Unsupported project: ${args.project}. Supported projects: ${Object.keys(PROJECTS).join(", ")}`);
  }

  const result = config.projectKey === "finance"
    ? await verifyFinance(config, args)
    : await verifyReiki(config, args);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printText(result);
  }

  if (result.result === "fail") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const result = {
    projectKey: "unknown",
    liveUrl: null,
    expectedCommit: null,
    observedCommit: "needs_verification",
    statusEndpoint: null,
    liveReachable: false,
    versionMatches: "needs_verification",
    checks: [],
    result: "fail",
    exactFailingCommand: "node scripts/openclaw-feedback-loop.mjs",
    summary: sanitizeError(error)
  };

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printText(result);
  }

  process.exitCode = 1;
});
