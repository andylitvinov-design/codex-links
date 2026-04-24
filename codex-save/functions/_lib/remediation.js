import {
  FETCH_TIMEOUT_MS,
  RESULT_BLOCKED,
  RESULT_DEGRADED,
  RESULT_FAIL,
  RESULT_PASS,
  RESULT_UNKNOWN
} from "./constants.js";
import { createDiagnosisRun, advanceDiagnosisRun } from "./diagnostics.js";
import { readDiagnosisRun, readLatestRemediationRun, readRemediationRun, saveRemediationRun } from "./runs.js";
import { createRunId } from "./storage.js";

function normalizeIssue(check) {
  return {
    checkId: String(check?.id || "").trim(),
    label: String(check?.label || "").trim(),
    status: String(check?.status || RESULT_UNKNOWN).trim(),
    summary: String(check?.summary || "").trim(),
    details: check?.details || null,
    canAutoFix: Boolean(check?.canAutoFix),
    manualRequired: Boolean(check?.manualRequired),
    fixCategory: String(check?.fixCategory || "").trim()
  };
}

function findCheck(diagnosisRun, checkId) {
  return (Array.isArray(diagnosisRun?.checks) ? diagnosisRun.checks : []).find((check) => check?.id === checkId) || null;
}

function isActiveRemediationStatus(status) {
  return ["planning", "queued", "in_progress", "rechecking"].includes(String(status || "").trim());
}

function isCloudRouteDegraded(diagnosisRun) {
  const textCloud = findCheck(diagnosisRun, "text-cloud");
  const photoCloud = findCheck(diagnosisRun, "photo-cloud");
  const textDirect = findCheck(diagnosisRun, "text-direct-openai");
  const photoDirect = findCheck(diagnosisRun, "photo-direct-openai");
  const statusApi = findCheck(diagnosisRun, "status-api");
  const degradedStatuses = new Set([RESULT_FAIL, RESULT_DEGRADED, RESULT_BLOCKED]);

  return degradedStatuses.has(String(textCloud?.status || "").trim())
    || [RESULT_FAIL, RESULT_BLOCKED].includes(String(photoCloud?.status || "").trim())
    || degradedStatuses.has(String(textDirect?.status || "").trim())
    || [RESULT_FAIL, RESULT_BLOCKED].includes(String(photoDirect?.status || "").trim())
    || String(statusApi?.details?.dispatchMode || "").trim() === "local-bridge";
}

function chooseRemediationRoute(diagnosisRun) {
  const textClaude = findCheck(diagnosisRun, "text-cloud");
  const photoClaude = findCheck(diagnosisRun, "photo-cloud");
  const textLocal = findCheck(diagnosisRun, "text-codex-bridge");
  const photoLocal = findCheck(diagnosisRun, "photo-codex-bridge");
  const statusApi = findCheck(diagnosisRun, "status-api");

  const localHealthy = String(textLocal?.status || "").trim() === RESULT_PASS
    || String(photoLocal?.status || "").trim() === RESULT_PASS
    || Boolean(statusApi?.details?.localBridgeOnline);

  if (localHealthy) {
    return {
      selectedDispatchMode: "local-bridge",
      selectedTargetExecutionMode: "bridge",
      selectionReason: isCloudRouteDegraded(diagnosisRun)
        ? "delivery-route-degraded-codex-bridge-healthy"
        : "default-agent-pr-flow-codex-bridge"
    };
  }

  const claudeHealthy = String(textClaude?.status || "").trim() === RESULT_PASS
    || String(photoClaude?.status || "").trim() === RESULT_PASS
    || Boolean(statusApi?.details?.claudeBridgeOnline);

  if (claudeHealthy) {
    return {
      selectedDispatchMode: "claude-bridge",
      selectedTargetExecutionMode: "claude",
      selectionReason: isCloudRouteDegraded(diagnosisRun)
        ? "codex-bridge-unavailable-claude-code-fallback"
        : "codex-bridge-unavailable-claude-code-healthy"
    };
  }

  return {
    selectedDispatchMode: "local-bridge",
    selectedTargetExecutionMode: "bridge",
    selectionReason: "no-healthy-fallback-try-codex-bridge"
  };
}

export function buildRemediationPlan(diagnosisRun) {
  const sourceChecks = Array.isArray(diagnosisRun?.checks) ? diagnosisRun.checks : [];
  const issues = sourceChecks
    .filter((check) => check.status !== RESULT_PASS && check.status !== RESULT_UNKNOWN)
    .map(normalizeIssue);
  const autoFixIssues = issues.filter((issue) => issue.canAutoFix && !issue.manualRequired);
  const manualIssues = issues.filter((issue) => issue.manualRequired || !issue.canAutoFix);

  return {
    diagnosisRunId: String(diagnosisRun?.runId || "").trim(),
    overallStatus: String(diagnosisRun?.overallStatus || RESULT_UNKNOWN).trim(),
    issueCount: issues.length,
    autoFixCount: autoFixIssues.length,
    manualCount: manualIssues.length,
    issues,
    actions: autoFixIssues.map((issue) => ({
      kind: "repo-fix",
      checkId: issue.checkId,
      summary: issue.summary,
      fixCategory: issue.fixCategory
    })),
    manualActions: manualIssues.map((issue) => ({
      kind: "manual-required",
      checkId: issue.checkId,
      summary: issue.summary,
      fixCategory: issue.fixCategory
    }))
  };
}

function buildPrompt(diagnosisRun, plan) {
  const issues = plan.issues
    .map((issue) => {
      const details = issue.details && typeof issue.details === "object"
        ? ` | details=${JSON.stringify(issue.details).slice(0, 700)}`
        : "";
      return `- ${issue.label}: ${issue.status} | ${issue.summary}${details}`;
    })
    .join("\n");
  const autoFixIds = plan.actions.map((action) => action.checkId).join(", ") || "none";
  const target = diagnosisRun?.target || {};

  return [
    "Remediation task for codex-links production delivery diagnostics.",
    "",
    "Goal:",
    "- Fix only the issues that are auto-fixable from the codex-links repo.",
    "- Use branch -> PR -> merge -> Pages deploy.",
    "- Do not push directly to main.",
    "",
    "Current diagnosis:",
    `- diagnosisRunId: ${diagnosisRun.runId}`,
    `- overallStatus: ${diagnosisRun.overallStatus}`,
    `- autoFixChecks: ${autoFixIds}`,
    `- targetRepo: ${target.targetRepo || "andylitvinov-design/codex-links"}`,
    `- targetRepoUrl: ${target.targetRepoUrl || "https://github.com/andylitvinov-design/codex-links"}`,
    `- targetWorkspacePath: ${target.targetWorkspacePath || "/Users/andriilitvinov/projects/MYPROJECTS/links"}`,
    `- contextFiles: ${(target.targetContextFiles || ["AGENTS.md", "README.md", "STATE.md"]).join(", ")}`,
    "",
    "Issues:",
    issues || "- none",
    "",
    "Instructions:",
    "- Work only inside the selected project boundary.",
    "- Start by reading AGENTS.md, README.md, and STATE.md in that order.",
    "- Fix route/config/code issues that caused the failing or degraded checks.",
    "- If a failing item is external-only, document it and do not fake a fix.",
    "- Run the smallest relevant tests for the changed behavior.",
    "- Create a branch, push it, open a PR, merge it, and deploy Cloudflare Pages in the same work session.",
    "- Do not finish until the deploy status is known.",
    "- Report exactly what changed, PR/deploy references, what remains manual, and any follow-up risk.",
    "",
    "Do not change unrelated areas."
  ].join("\n");
}

async function fetchJsonWithTimeout(fetchImpl, url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: init.signal || controller.signal
    });
    const body = await response.json().catch(() => null);
    return { response, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function postFixCommand(target, plan, diagnosisRun, routeSelection, fetchImpl) {
  const payload = {
    clientId: `codex-save-fix-${Date.now()}`,
    threadId: target.threadId,
    threadLabel: target.threadLabel,
    projectId: target.projectId,
    dispatchMode: routeSelection.selectedDispatchMode,
    targetExecutionMode: routeSelection.selectedTargetExecutionMode,
    targetRepo: target.targetRepo,
    targetRepoUrl: target.targetRepoUrl,
    targetWorkspacePath: target.targetWorkspacePath,
    targetContextFiles: target.targetContextFiles,
    text: buildPrompt(diagnosisRun, plan)
  };

  const { response, body } = await fetchJsonWithTimeout(fetchImpl, `${target.baseUrl}/api/commands`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok || !body?.command?.id) {
    throw new Error(String(body?.error || `Could not create remediation command (HTTP ${response.status}).`).trim());
  }

  return body.command;
}

function buildReport(beforeRun, afterRun, remediationRun) {
  const beforeMap = new Map((Array.isArray(beforeRun?.checks) ? beforeRun.checks : []).map((check) => [check.id, check.status]));
  const afterChecks = Array.isArray(afterRun?.checks) ? afterRun.checks : [];
  const changes = [];
  const unresolved = [];

  for (const check of afterChecks) {
    const beforeStatus = beforeMap.get(check.id) || RESULT_UNKNOWN;
    const afterStatus = String(check.status || RESULT_UNKNOWN).trim();

    if (beforeStatus === afterStatus) {
      if (afterStatus !== RESULT_PASS) {
        unresolved.push({
          checkId: check.id,
          label: check.label,
          status: afterStatus,
          summary: check.summary
        });
      }
      continue;
    }

    changes.push({
      checkId: check.id,
      label: check.label,
      before: beforeStatus,
      after: afterStatus,
      summary: check.summary
    });

    if (afterStatus !== RESULT_PASS && afterStatus !== RESULT_DEGRADED) {
      unresolved.push({
        checkId: check.id,
        label: check.label,
        status: afterStatus,
        summary: check.summary
      });
    }
  }

  return {
    timestamp: new Date().toISOString(),
    recheckScope: String(remediationRun?.recheckScope || "full").trim(),
    recheckedCheckIds: Array.isArray(remediationRun?.recheckedCheckIds) ? remediationRun.recheckedCheckIds : [],
    baselineSummary: {
      diagnosisRunId: beforeRun?.runId || "",
      overallStatus: beforeRun?.overallStatus || RESULT_UNKNOWN
    },
    appliedActions: remediationRun?.plan?.actions || [],
    recheckSummary: {
      diagnosisRunId: afterRun?.runId || "",
      overallStatus: afterRun?.overallStatus || RESULT_UNKNOWN
    },
    changes,
    unresolved,
    recommendedNextManualSteps: unresolved.map((item) => `${item.label}: ${item.summary}`)
  };
}

export async function createRemediationRun(env, sourceDiagnosisId, fetchImpl = fetch) {
  const diagnosisRun = await readDiagnosisRun(env, sourceDiagnosisId);
  if (!diagnosisRun) {
    throw new Error("Diagnosis run was not found.");
  }

  const latestRemediation = await readLatestRemediationRun(env);
  if (
    latestRemediation
    && String(latestRemediation.sourceDiagnosisId || "").trim() === String(sourceDiagnosisId || "").trim()
    && isActiveRemediationStatus(latestRemediation.status)
  ) {
    return latestRemediation;
  }

  const currentDiagnosisRun = await advanceDiagnosisRun(env, diagnosisRun, fetchImpl);
  if (currentDiagnosisRun?.status !== "completed") {
    const error = new Error("Diagnosis is still running. Wait until all checks complete before starting remediation.");
    error.status = 409;
    error.code = "diagnosis_running";
    throw error;
  }

  const plan = buildRemediationPlan(currentDiagnosisRun);
  const routeSelection = chooseRemediationRoute(currentDiagnosisRun);
  const run = {
    runId: createRunId("remediation"),
    kind: "remediation",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: "",
    sourceDiagnosisId: currentDiagnosisRun.runId,
    target: currentDiagnosisRun.target,
    plan,
    actions: [],
    status: "planning",
    recheckId: "",
    recheckScope: "selective",
    recheckedCheckIds: plan.actions.map((action) => action.checkId).filter(Boolean),
    report: null
  };

  if (plan.issueCount === 0) {
    run.status = "not_needed";
    run.completedAt = new Date().toISOString();
    return saveRemediationRun(env, run);
  }

  if (plan.autoFixCount === 0) {
    run.status = "manual_required";
    run.completedAt = new Date().toISOString();
    run.actions = plan.manualActions;
    return saveRemediationRun(env, run);
  }

  const command = await postFixCommand(run.target, plan, currentDiagnosisRun, routeSelection, fetchImpl);
  run.status = "queued";
  run.actions = [{
    kind: "agent-command",
    commandId: String(command.id || "").trim(),
    status: String(command.status || "queued").trim(),
    dispatchMode: String(command.dispatchMode || "").trim(),
    selectedDispatchMode: routeSelection.selectedDispatchMode,
    selectedTargetExecutionMode: routeSelection.selectedTargetExecutionMode,
    selectionReason: routeSelection.selectionReason
  }];

  return saveRemediationRun(env, run);
}

export async function advanceRemediationRun(env, inputRun, fetchImpl = fetch) {
  let run = inputRun;
  if (!run) {
    return null;
  }

  if (run.status === "manual_required" || run.status === "not_needed" || run.status === "failed") {
    return run;
  }

  const agentAction = Array.isArray(run.actions)
    ? run.actions.find((action) => action.kind === "agent-command" && action.commandId)
    : null;

  if (agentAction && !run.recheckId) {
    const { body } = await fetchJsonWithTimeout(fetchImpl, `${run.target.baseUrl}/api/commands?id=${encodeURIComponent(agentAction.commandId)}`, {
      headers: { accept: "application/json" }
    });
    const command = body?.command || null;

    if (!command) {
      return saveRemediationRun(env, {
        ...run,
        updatedAt: new Date().toISOString()
      });
    }

    const commandStatus = String(command.status || "").trim().toLowerCase();
    run = {
      ...run,
      status: commandStatus === "answered"
        ? "rechecking"
        : (commandStatus === "failed" ? "failed" : "in_progress"),
      actions: [{
        ...agentAction,
        status: commandStatus,
        actualExecutor: String(command.actualExecutor || "").trim(),
        branchName: String(command.branchName || "").trim(),
        prUrl: String(command.prUrl || "").trim(),
        deployUrl: String(command.deployUrl || command.deploymentUrl || "").trim()
      }],
      updatedAt: new Date().toISOString(),
      completedAt: commandStatus === "failed" ? new Date().toISOString() : ""
    };

    if (commandStatus === "failed") {
      return saveRemediationRun(env, run);
    }

    if (commandStatus === "answered") {
      const recheck = await createDiagnosisRun(env, {
        reason: "recheck",
        target: run.target,
        scope: run.recheckScope,
        checkIds: run.recheckedCheckIds
      });
      run.recheckId = recheck.runId;
      await saveRemediationRun(env, run);
    } else {
      return saveRemediationRun(env, run);
    }
  }

  if (run.recheckId) {
    let recheckRun = await readDiagnosisRun(env, run.recheckId);
    recheckRun = await advanceDiagnosisRun(env, recheckRun, fetchImpl);

    if (recheckRun?.status === "completed") {
      const beforeRun = await readDiagnosisRun(env, run.sourceDiagnosisId);
      run = {
        ...run,
        status: "completed",
        completedAt: new Date().toISOString(),
        report: buildReport(beforeRun, recheckRun, run)
      };
    } else {
      run = {
        ...run,
        status: "rechecking"
      };
    }
  }

  return saveRemediationRun(env, run);
}

export async function readAndAdvanceRemediationRun(env, runId, fetchImpl = fetch) {
  const run = await readRemediationRun(env, runId);
  return advanceRemediationRun(env, run, fetchImpl);
}
