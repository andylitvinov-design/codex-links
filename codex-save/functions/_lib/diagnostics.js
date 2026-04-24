import {
  CHECK_STATE_COMPLETED,
  CHECK_STATE_PENDING,
  CHECK_STATE_RUNNING,
  DEFAULT_TARGET,
  DELIVERY_CHECK_TIMEOUT_MS,
  PHOTO_DATA_URL,
  RESULT_BLOCKED,
  RESULT_DEGRADED,
  RESULT_FAIL,
  RESULT_PASS,
  RESULT_UNKNOWN
} from "./constants.js";
import { createRunId } from "./storage.js";
import { readDiagnosisRun, saveDiagnosisRun } from "./runs.js";

const CHECK_DEFINITIONS = [
  {
    id: "site-availability",
    label: "Site availability",
    kind: "site",
    route: "site",
    group: "base"
  },
  {
    id: "status-api",
    label: "API status",
    kind: "status",
    route: "api",
    group: "base"
  },
  {
    id: "text-codex-bridge",
    label: "Text via Codex bridge",
    kind: "delivery",
    route: "local-bridge",
    group: "text",
    mode: "text",
    expectedExecutor: "bridge"
  },
  {
    id: "text-cloud-bridge",
    label: "Text via Cloud bridge",
    kind: "delivery",
    route: "claude-bridge",
    group: "text",
    mode: "text",
    expectedExecutor: "claude"
  },
  {
    id: "text-cloud",
    label: "Text via cloud",
    kind: "delivery",
    route: "cloud",
    group: "text",
    mode: "text",
    expectedExecutor: "direct-openai"
  },
  {
    id: "photo-codex-bridge",
    label: "Photo via Codex bridge",
    kind: "delivery",
    route: "local-bridge",
    group: "photo",
    mode: "photo",
    expectedExecutor: "bridge"
  },
  {
    id: "photo-cloud-bridge",
    label: "Photo via Cloud bridge",
    kind: "delivery",
    route: "claude-bridge",
    group: "photo",
    mode: "photo",
    expectedExecutor: "claude"
  },
  {
    id: "photo-cloud",
    label: "Photo via cloud",
    kind: "delivery",
    route: "cloud",
    group: "photo",
    mode: "photo",
    expectedExecutor: "direct-openai"
  }
];

function normalizeTarget(env, input = {}) {
  return {
    baseUrl: String(input.baseUrl || env.CODEX_LINKS_BASE_URL || DEFAULT_TARGET.baseUrl).trim().replace(/\/+$/, ""),
    threadId: String(input.threadId || env.CODEX_SAVE_TARGET_THREAD_ID || DEFAULT_TARGET.threadId).trim(),
    threadLabel: String(input.threadLabel || DEFAULT_TARGET.threadLabel).trim(),
    projectId: String(input.projectId || env.CODEX_SAVE_TARGET_PROJECT_ID || DEFAULT_TARGET.projectId).trim(),
    targetRepo: String(input.targetRepo || env.CODEX_SAVE_TARGET_REPO || DEFAULT_TARGET.targetRepo).trim(),
    targetRepoUrl: String(input.targetRepoUrl || env.CODEX_SAVE_TARGET_REPO_URL || DEFAULT_TARGET.targetRepoUrl).trim(),
    targetContextFiles: Array.isArray(input.targetContextFiles) && input.targetContextFiles.length
      ? input.targetContextFiles.map((entry) => String(entry || "").trim()).filter(Boolean)
      : [...DEFAULT_TARGET.targetContextFiles]
  };
}

function createCheck(definition) {
  return {
    ...definition,
    state: CHECK_STATE_PENDING,
    status: RESULT_UNKNOWN,
    summary: "Waiting to run.",
    details: null,
    startedAt: "",
    completedAt: "",
    canAutoFix: false,
    fixCategory: ""
  };
}

function normalizeScope(value) {
  return String(value || "").trim().toLowerCase() === "selective" ? "selective" : "full";
}

function normalizeCheckIds(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )];
}

function selectCheckDefinitions(scope, checkIds) {
  if (scope !== "selective" || !checkIds.length) {
    return CHECK_DEFINITIONS;
  }

  return CHECK_DEFINITIONS.filter((definition) => checkIds.includes(definition.id));
}

function buildRecommendation(check) {
  const label = String(check?.label || "").trim() || "Check";
  const status = String(check?.status || RESULT_UNKNOWN).trim();
  const fixCategory = String(check?.fixCategory || "").trim();
  const actualExecutor = String(check?.details?.actualExecutor || "").trim();
  const expectedExecutor = String(check?.details?.expectedExecutor || check?.expectedExecutor || "").trim();

  if (status === RESULT_PASS) {
    return null;
  }

  if (check?.id === "status-api" && String(check?.details?.slackActorStatus || "").trim() === "unverified") {
    return {
      checkId: check.id,
      severity: "warning",
      title: "Проверить Slack actor validation",
      summary: "Status API жив, но Slack actor не верифицирован.",
      recommendation: "Проверь `SLACK_CODEX_USER_ID`, валидность реального worker user и внешний Slack/Codex cloud actor. Это manual-only проблема вне локального code path.",
      actionType: "manual"
    };
  }

  if (fixCategory === "delivery-routing" && actualExecutor && expectedExecutor) {
    return {
      checkId: check.id,
      severity: status === RESULT_FAIL ? "error" : "warning",
      title: `Починить routing для ${label}`,
      summary: `${label} ушёл через ${actualExecutor}, хотя ожидался ${expectedExecutor}.`,
      recommendation: "Проверь логику выбора `dispatchMode`/`targetExecutionMode`, fallback path и route-specific ограничения в `codex-links`. Это candidate для auto-fix через кнопку `Исправить`.",
      actionType: "autofix"
    };
  }

  if (fixCategory === "platform-limitation") {
    return {
      checkId: check.id,
      severity: "warning",
      title: `Зафиксировать ограничение для ${label}`,
      summary: `${label} сейчас не удерживается на целевом cloud executor.`,
      recommendation: "Сначала подтвердить, это design/platform limitation или баг. До подтверждения не обещать автоматический fix; держать как manual review item.",
      actionType: "manual"
    };
  }

  if (fixCategory === "site-availability") {
    return {
      checkId: check.id,
      severity: "error",
      title: "Проверить доступность сайта",
      summary: "Базовая проверка сайта не прошла.",
      recommendation: "Проверь production deploy status, Pages project routing и доступность origin/static bundle перед любыми code fixes.",
      actionType: "manual"
    };
  }

  return {
    checkId: check.id,
    severity: status === RESULT_FAIL ? "error" : "warning",
    title: `Разобрать ${label}`,
    summary: String(check?.summary || "").trim() || `${label} требует внимания.`,
    recommendation: check?.manualRequired
      ? "Эта проблема требует ручной проверки внешнего контура или конфигурации."
      : "Эта проблема выглядит исправимой из репозитория и может быть передана в remediation flow.",
    actionType: check?.manualRequired ? "manual" : "autofix"
  };
}

export function summarizeOverallStatus(checks) {
  const statuses = (Array.isArray(checks) ? checks : []).map((check) => check?.status);

  if (statuses.some((status) => status === RESULT_FAIL)) {
    return RESULT_FAIL;
  }

  if (statuses.some((status) => status === RESULT_BLOCKED)) {
    return RESULT_BLOCKED;
  }

  if (statuses.some((status) => status === RESULT_DEGRADED)) {
    return RESULT_DEGRADED;
  }

  if (statuses.length && statuses.every((status) => status === RESULT_PASS)) {
    return RESULT_PASS;
  }

  return RESULT_UNKNOWN;
}

async function fetchJson(url, init = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, init);
  const body = await response.json().catch(() => null);
  return { response, body };
}

function buildProbeText(check) {
  const token = `CODEX_SAVE_${check.id.replace(/[^a-z0-9]+/gi, "_").toUpperCase()}_OK`;
  if (check.mode === "photo") {
    return `photo ${check.route} probe ignore: reply with ${token} only after reading the attached image`;
  }
  return `delivery-probe: reply with ${token} only`;
}

function buildCommandPayload(target, check, run) {
  const base = {
    clientId: `codex-save-${run.runId}-${check.id}`.slice(0, 120),
    threadId: target.threadId,
    threadLabel: target.threadLabel,
    projectId: target.projectId,
    targetRepo: target.targetRepo,
    targetRepoUrl: target.targetRepoUrl,
    targetContextFiles: target.targetContextFiles,
    text: buildProbeText(check)
  };

  if (check.route === "local-bridge") {
    base.dispatchMode = "local-bridge";
    base.targetExecutionMode = "bridge";
  } else if (check.route === "claude-bridge") {
    base.dispatchMode = "claude-bridge";
    base.targetExecutionMode = "claude";
  } else {
    base.dispatchMode = "cloud";
    base.targetExecutionMode = "direct-openai";
  }

  if (check.mode === "photo") {
    base.photo = {
      contentType: "image/png",
      fileName: `${check.id}.png`,
      size: 68,
      dataUrl: PHOTO_DATA_URL
    };
  }

  return base;
}

function getFixMetadata(check, status, details = {}) {
  if (check.id === "status-api" && details?.slackActorStatus === "unverified") {
    return {
      canAutoFix: false,
      fixCategory: "external-auth",
      manualRequired: true
    };
  }

  if (check.route === "cloud" && check.mode === "photo" && (status === RESULT_BLOCKED || details?.reasonCode === "unexpected_executor")) {
    return {
      canAutoFix: false,
      fixCategory: "platform-limitation",
      manualRequired: true
    };
  }

  if (check.kind === "site") {
    return {
      canAutoFix: false,
      fixCategory: "site-availability",
      manualRequired: true
    };
  }

  if (status === RESULT_PASS) {
    return {
      canAutoFix: false,
      fixCategory: "",
      manualRequired: false
    };
  }

  if (status === RESULT_DEGRADED || status === RESULT_FAIL) {
    return {
      canAutoFix: true,
      fixCategory: check.kind === "status" ? "status-consistency" : "delivery-routing",
      manualRequired: false
    };
  }

  return {
    canAutoFix: false,
    fixCategory: "manual-investigation",
    manualRequired: true
  };
}

async function runSiteCheck(target, check, fetchImpl) {
  const startedAt = new Date().toISOString();

  try {
    const response = await fetchImpl(`${target.baseUrl}/?_=${Date.now()}`, {
      headers: { accept: "text/html" }
    });

    if (!response.ok) {
      const metadata = getFixMetadata(check, RESULT_FAIL);
      return {
        ...check,
        state: CHECK_STATE_COMPLETED,
        status: RESULT_FAIL,
        summary: `Site returned HTTP ${response.status}.`,
        details: {
          httpStatus: response.status
        },
        startedAt,
        completedAt: new Date().toISOString(),
        ...metadata
      };
    }

    return {
      ...check,
      state: CHECK_STATE_COMPLETED,
      status: RESULT_PASS,
      summary: "Site responded successfully.",
      details: {
        httpStatus: response.status
      },
      startedAt,
      completedAt: new Date().toISOString(),
      canAutoFix: false,
      fixCategory: ""
    };
  } catch (error) {
    const metadata = getFixMetadata(check, RESULT_FAIL);
    return {
      ...check,
      state: CHECK_STATE_COMPLETED,
      status: RESULT_FAIL,
      summary: `Site check failed: ${String(error?.message || error).trim() || "unknown error"}.`,
      details: {
        error: String(error?.message || error || "").trim()
      },
      startedAt,
      completedAt: new Date().toISOString(),
      ...metadata
    };
  }
}

async function runStatusCheck(target, check, fetchImpl) {
  const startedAt = new Date().toISOString();

  try {
    const { response, body } = await fetchJson(`${target.baseUrl}/api/status?_=${Date.now()}`, {
      headers: { accept: "application/json" }
    }, fetchImpl);

    if (!response.ok || !body?.status) {
      const metadata = getFixMetadata(check, RESULT_FAIL);
      return {
        ...check,
        state: CHECK_STATE_COMPLETED,
        status: RESULT_FAIL,
        summary: `Status API failed with HTTP ${response.status}.`,
        details: {
          httpStatus: response.status
        },
        startedAt,
        completedAt: new Date().toISOString(),
        ...metadata
      };
    }

    const slackActorStatus = String(body.status?.slackActor?.validationStatus || "").trim().toLowerCase();
    const isUnverified = slackActorStatus === "unverified";
    const resultStatus = isUnverified ? RESULT_DEGRADED : RESULT_PASS;
    const metadata = getFixMetadata(check, resultStatus, { slackActorStatus });

    return {
      ...check,
      state: CHECK_STATE_COMPLETED,
      status: resultStatus,
      summary: isUnverified
        ? "Status API is live, but Slack actor validation is unverified."
        : "Status API is live and returned a healthy status payload.",
      details: {
        httpStatus: response.status,
        dispatchMode: String(body.status?.dispatchMode || "").trim(),
        executorLabel: String(body.status?.executorLabel || "").trim(),
        slackActorStatus,
        localBridgeOnline: Boolean(body.status?.localBridge?.online),
        claudeBridgeOnline: Boolean(body.status?.claudeBridge?.online)
      },
      startedAt,
      completedAt: new Date().toISOString(),
      ...metadata
    };
  } catch (error) {
    const metadata = getFixMetadata(check, RESULT_FAIL);
    return {
      ...check,
      state: CHECK_STATE_COMPLETED,
      status: RESULT_FAIL,
      summary: `Status API check failed: ${String(error?.message || error).trim() || "unknown error"}.`,
      details: {
        error: String(error?.message || error || "").trim()
      },
      startedAt,
      completedAt: new Date().toISOString(),
      ...metadata
    };
  }
}

function classifyDeliveryCompletion(check, command) {
  const actualExecutor = String(command?.actualExecutor || "").trim();
  const status = String(command?.status || "").trim().toLowerCase();
  const dispatchMode = String(command?.dispatchMode || "").trim();
  const reasonCode = actualExecutor && actualExecutor !== check.expectedExecutor
    ? "unexpected_executor"
    : (String(command?.photoUnsupportedReason || "").trim() ? "photo_unsupported" : "");

  if (status === "failed") {
    const resultStatus = check.route === "cloud" && check.mode === "photo" ? RESULT_BLOCKED : RESULT_FAIL;
    const metadata = getFixMetadata(check, resultStatus, { reasonCode });
    return {
      status: resultStatus,
      summary: String(command?.errorMessage || "Probe command failed.").trim() || "Probe command failed.",
      details: {
        reasonCode: reasonCode || "command_failed",
        commandId: String(command?.id || "").trim(),
        actualExecutor,
        dispatchMode,
        progressStage: String(command?.progressStage || "").trim(),
        errorMessage: String(command?.errorMessage || "").trim(),
        photoUnsupportedReason: String(command?.photoUnsupportedReason || "").trim()
      },
      ...metadata
    };
  }

  if (actualExecutor === check.expectedExecutor) {
    return {
      status: RESULT_PASS,
      summary: `${check.label} completed on the expected executor.`,
      details: {
        commandId: String(command?.id || "").trim(),
        actualExecutor,
        dispatchMode,
        progressStage: String(command?.progressStage || "").trim()
      },
      canAutoFix: false,
      fixCategory: "",
      manualRequired: false
    };
  }

  const resultStatus = check.route === "cloud" && check.mode === "photo" ? RESULT_BLOCKED : RESULT_FAIL;
  const metadata = getFixMetadata(check, resultStatus, { reasonCode });
  return {
    status: resultStatus,
    summary: `${check.label} replied through ${actualExecutor || "an unexpected executor"} instead of ${check.expectedExecutor}.`,
    details: {
      reasonCode: reasonCode || "unexpected_executor",
      commandId: String(command?.id || "").trim(),
      actualExecutor,
      expectedExecutor: check.expectedExecutor,
      dispatchMode,
      progressStage: String(command?.progressStage || "").trim(),
      photoUnsupportedReason: String(command?.photoUnsupportedReason || "").trim()
    },
    ...metadata
  };
}

async function startDeliveryCheck(target, check, run, fetchImpl) {
  const payload = buildCommandPayload(target, check, run);
  const { response, body } = await fetchJson(`${target.baseUrl}/api/commands`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify(payload)
  }, fetchImpl);

  if (!response.ok || !body?.command?.id) {
    const metadata = getFixMetadata(check, RESULT_FAIL);
    return {
      ...check,
      state: CHECK_STATE_COMPLETED,
      status: RESULT_FAIL,
      summary: String(body?.error || `Could not create probe command (HTTP ${response.status}).`).trim(),
      details: {
        httpStatus: response.status,
        responseBody: body
      },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      ...metadata
    };
  }

  return {
    ...check,
    state: CHECK_STATE_RUNNING,
    status: RESULT_UNKNOWN,
    summary: "Probe command created. Waiting for executor result.",
    details: {
      commandId: String(body.command.id || "").trim(),
      createdDispatchMode: String(body.command.dispatchMode || "").trim(),
      requestedRoute: check.route
    },
    startedAt: new Date().toISOString(),
    completedAt: "",
    canAutoFix: false,
    fixCategory: ""
  };
}

async function pollDeliveryCheck(target, check, fetchImpl) {
  const commandId = String(check?.details?.commandId || "").trim();

  if (!commandId) {
    const metadata = getFixMetadata(check, RESULT_FAIL);
    return {
      ...check,
      state: CHECK_STATE_COMPLETED,
      status: RESULT_FAIL,
      summary: "Probe command id is missing.",
      details: {
        reasonCode: "missing_command_id"
      },
      completedAt: new Date().toISOString(),
      ...metadata
    };
  }

  const startedAt = Date.parse(String(check.startedAt || "").trim());
  if (!Number.isNaN(startedAt) && (Date.now() - startedAt) > DELIVERY_CHECK_TIMEOUT_MS) {
    const resultStatus = check.route === "cloud" && check.mode === "photo" ? RESULT_BLOCKED : RESULT_FAIL;
    const metadata = getFixMetadata(check, resultStatus, { reasonCode: "timeout" });
    return {
      ...check,
      state: CHECK_STATE_COMPLETED,
      status: resultStatus,
      summary: `${check.label} timed out while waiting for a terminal command result.`,
      details: {
        reasonCode: "timeout",
        commandId
      },
      completedAt: new Date().toISOString(),
      ...metadata
    };
  }

  const { response, body } = await fetchJson(`${target.baseUrl}/api/commands?id=${encodeURIComponent(commandId)}`, {
    headers: { accept: "application/json" }
  }, fetchImpl);

  if (!response.ok || !body?.command) {
    return {
      ...check,
      summary: `Still waiting for probe command ${commandId}.`
    };
  }

  const command = body.command;
  const status = String(command?.status || "").trim().toLowerCase();

  if (status === "answered" || status === "failed") {
    const result = classifyDeliveryCompletion(check, command);
    return {
      ...check,
      state: CHECK_STATE_COMPLETED,
      status: result.status,
      summary: result.summary,
      details: result.details,
      completedAt: new Date().toISOString(),
      canAutoFix: result.canAutoFix,
      fixCategory: result.fixCategory,
      manualRequired: result.manualRequired
    };
  }

  return {
    ...check,
    summary: `${check.label} is still running (${String(command?.progressStage || status || "processing").trim()}).`,
    details: {
      ...(check.details || {}),
      commandId,
      liveStatus: status,
      progressStage: String(command?.progressStage || "").trim(),
      actualExecutor: String(command?.actualExecutor || "").trim()
    }
  };
}

function buildCounts(checks) {
  return (Array.isArray(checks) ? checks : []).reduce((accumulator, check) => {
    const key = String(check?.status || RESULT_UNKNOWN);
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {
    [RESULT_PASS]: 0,
    [RESULT_DEGRADED]: 0,
    [RESULT_FAIL]: 0,
    [RESULT_BLOCKED]: 0,
    [RESULT_UNKNOWN]: 0
  });
}

function buildProgress(checks) {
  const source = Array.isArray(checks) ? checks : [];
  const runningChecks = source.filter((check) => check.state === CHECK_STATE_RUNNING);
  const completedCount = source.filter((check) => check.state === CHECK_STATE_COMPLETED).length;
  const pendingCount = source.filter((check) => check.state === CHECK_STATE_PENDING).length;

  return {
    runningCount: runningChecks.length,
    completedCount,
    pendingCount,
    runningGroups: [...new Set(runningChecks.map((check) => String(check.group || "").trim()).filter(Boolean))]
  };
}

function buildRecommendations(checks) {
  return (Array.isArray(checks) ? checks : [])
    .map((check) => buildRecommendation(check))
    .filter(Boolean);
}

function finalizeDiagnosisRun(run) {
  const allCompleted = run.checks.every((check) => check.state === CHECK_STATE_COMPLETED);
  const progress = buildProgress(run.checks);
  return {
    ...run,
    status: allCompleted ? "completed" : "running",
    overallStatus: summarizeOverallStatus(run.checks),
    counts: buildCounts(run.checks),
    ...progress,
    recommendations: buildRecommendations(run.checks),
    completedAt: allCompleted ? new Date().toISOString() : "",
    updatedAt: new Date().toISOString()
  };
}

export async function createDiagnosisRun(env, input = {}) {
  const scope = normalizeScope(input.scope);
  const checkIds = normalizeCheckIds(input.checkIds);
  const selectedDefinitions = selectCheckDefinitions(scope, checkIds);
  const run = {
    runId: createRunId("diagnosis"),
    kind: "diagnosis",
    reason: String(input.reason || "diagnostics").trim(),
    scope,
    checkIds: scope === "selective" ? checkIds : [],
    status: "running",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: "",
    target: normalizeTarget(env, input.target),
    overallStatus: RESULT_UNKNOWN,
    checks: selectedDefinitions.map(createCheck),
    counts: buildCounts([]),
    runningCount: 0,
    completedCount: 0,
    pendingCount: selectedDefinitions.length,
    runningGroups: [],
    recommendations: []
  };

  return saveDiagnosisRun(env, run);
}

export async function advanceDiagnosisRun(env, inputRun, fetchImpl = fetch) {
  let run = inputRun;
  if (!run) {
    return null;
  }

  if (run.status === "completed" || run.status === "failed") {
    return run;
  }

  const checks = await Promise.all((Array.isArray(run.checks) ? run.checks : []).map(async (check) => {
    if (check.state === CHECK_STATE_RUNNING) {
      return pollDeliveryCheck(run.target, check, fetchImpl);
    }

    if (check.state !== CHECK_STATE_PENDING) {
      return check;
    }

    if (check.kind === "site") {
      return runSiteCheck(run.target, check, fetchImpl);
    }

    if (check.kind === "status") {
      return runStatusCheck(run.target, check, fetchImpl);
    }

    return startDeliveryCheck(run.target, check, run, fetchImpl);
  }));

  run = finalizeDiagnosisRun({
    ...run,
    checks
  });
  return saveDiagnosisRun(env, run);
}

export async function readAndAdvanceDiagnosisRun(env, runId, fetchImpl = fetch) {
  const run = await readDiagnosisRun(env, runId);
  return advanceDiagnosisRun(env, run, fetchImpl);
}
