export const CLOUD_GUARDIAN_TIMEOUTS = {
  prTimeoutMs: 90 * 60 * 1000,
  mergeTimeoutMs: 120 * 60 * 1000,
  productionVerifyTimeoutMs: 30 * 60 * 1000
};

function toTimestamp(value) {
  const timestamp = Date.parse(String(value || "").trim());
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isOlderThan(value, nowMs, timeoutMs) {
  const timestamp = toTimestamp(value);
  return Boolean(timestamp) && nowMs - timestamp > timeoutMs;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function isTerminalDeliveryStatus(value) {
  const status = normalizeText(value).toLowerCase();
  return status === "production-verified" || status === "blocked" || status === "mirrored";
}

export function getGuardianCandidateReason(command, nowMs = Date.now(), timeouts = CLOUD_GUARDIAN_TIMEOUTS) {
  const entry = command && typeof command === "object" ? command : {};
  const dispatchMode = normalizeText(entry.dispatchMode);
  const deliveryStatus = normalizeText(entry.deliveryStatus).toLowerCase();

  if (!entry.productionVerifiable && !entry.deploy?.productionUrl) {
    return "";
  }

  if (isTerminalDeliveryStatus(deliveryStatus)) {
    return "";
  }

  if (dispatchMode !== "slack-codex-cloud" && dispatchMode !== "cloud") {
    return "";
  }

  if (!normalizeText(entry.prUrl)) {
    return isOlderThan(entry.dispatchedAt || entry.dispatchStartedAt || entry.createdAt, nowMs, timeouts.prTimeoutMs)
      ? "pr-timeout"
      : "";
  }

  if (!normalizeText(entry.mergeCommit)) {
    return isOlderThan(entry.resultAt || entry.progressUpdatedAt || entry.createdAt, nowMs, timeouts.mergeTimeoutMs)
      ? "merge-timeout"
      : "pr-ready";
  }

  if (!normalizeText(entry.productionVerifiedAt)) {
    return isOlderThan(entry.resultAt || entry.progressUpdatedAt || entry.createdAt, nowMs, timeouts.productionVerifyTimeoutMs)
      ? "production-verify-timeout"
      : "merged";
  }

  return "";
}

export function evaluateCloudDeliveryCommand(command, facts = {}, options = {}) {
  const nowIso = options.nowIso || new Date().toISOString();
  const nowMs = toTimestamp(nowIso) || Date.now();
  const timeouts = options.timeouts || CLOUD_GUARDIAN_TIMEOUTS;
  const reason = getGuardianCandidateReason(command, nowMs, timeouts);
  const pr = facts.pr && typeof facts.pr === "object" ? facts.pr : {};
  const smoke = facts.smoke && typeof facts.smoke === "object" ? facts.smoke : {};
  const prUrl = normalizeText(command?.prUrl || pr.url);
  const mergeCommit = normalizeText(pr.mergeCommit || command?.mergeCommit);
  const productionUrl = normalizeText(command?.productionUrl || command?.deploy?.productionUrl || smoke.url);

  if (prUrl && pr.merged && mergeCommit && smoke.ok) {
    return {
      action: "update",
      update: {
        id: command.id,
        status: command.status || "answered",
        progressStage: "production-verified",
        prUrl,
        branchName: command.branchName || pr.branchName || "",
        mergeCommit,
        productionUrl,
        productionVerifiedAt: nowIso,
        deliveryStatus: "production-verified",
        lastDiagnosticCode: "",
        lastDiagnosticDetail: ""
      },
      report: buildCloudGuardianReport(command, {
        status: "production-verified",
        prUrl,
        mergeCommit,
        productionUrl,
        detail: "Production smoke check passed."
      })
    };
  }

  if (reason === "pr-timeout") {
    return {
      action: "fallback",
      update: {
        id: command.id,
        status: command.status || "processing",
        progressStage: "fallback-to-bridge",
        deliveryStatus: "fallback-running",
        lastDiagnosticCode: "cloud_pr_timeout",
        lastDiagnosticDetail: "Codex Cloud did not report a PR URL within the guardian PR timeout.",
        errorMessage: "Codex Cloud did not report a PR URL in time. Fallback to local bridge is required."
      },
      report: buildCloudGuardianReport(command, {
        status: "fallback-running",
        detail: "No PR URL appeared before the guardian timeout. Local bridge fallback should take over."
      })
    };
  }

  if (reason === "merge-timeout") {
    return {
      action: "blocked",
      update: {
        id: command.id,
        status: command.status || "answered",
        progressStage: "blocked",
        prUrl,
        deliveryStatus: "blocked",
        lastDiagnosticCode: "cloud_merge_timeout",
        lastDiagnosticDetail: "A PR was reported, but it was not observed as merged within the guardian merge timeout.",
        errorMessage: "Cloud PR was not observed as merged in time."
      },
      report: buildCloudGuardianReport(command, {
        status: "blocked",
        prUrl,
        detail: "PR exists but merge was not confirmed before timeout."
      })
    };
  }

  if (reason === "production-verify-timeout" || (mergeCommit && smoke.ok === false)) {
    return {
      action: "blocked",
      update: {
        id: command.id,
        status: command.status || "answered",
        progressStage: "blocked",
        prUrl,
        mergeCommit,
        productionUrl,
        deliveryStatus: "blocked",
        lastDiagnosticCode: "cloud_production_verify_failed",
        lastDiagnosticDetail: smoke.error || "Production smoke check did not pass within the guardian timeout.",
        errorMessage: smoke.error || "Production verification failed after Cloud merge."
      },
      report: buildCloudGuardianReport(command, {
        status: "blocked",
        prUrl,
        mergeCommit,
        productionUrl,
        detail: smoke.error || "Production smoke check failed or timed out."
      })
    };
  }

  if (prUrl && !normalizeText(command?.deliveryStatus)) {
    return {
      action: "update",
      update: {
        id: command.id,
        status: command.status || "answered",
        progressStage: "pr-ready",
        prUrl,
        branchName: command.branchName || pr.branchName || "",
        deliveryStatus: "pr-ready"
      },
      report: null
    };
  }

  if (mergeCommit && normalizeText(command?.deliveryStatus) !== "merged") {
    return {
      action: "update",
      update: {
        id: command.id,
        status: command.status || "answered",
        progressStage: "merged",
        prUrl,
        branchName: command.branchName || pr.branchName || "",
        mergeCommit,
        productionUrl,
        deliveryStatus: "merged"
      },
      report: null
    };
  }

  return {
    action: "none",
    update: null,
    report: null
  };
}

export function buildCloudGuardianReport(command, result) {
  const project = normalizeText(command?.projectLabel || command?.threadLabel || command?.projectId || command?.threadId || "unknown");
  const status = normalizeText(result?.status || "unknown");

  return [
    `Codex Links Cloud Report`,
    `Status: ${status}`,
    `Project: ${project}`,
    `Command ID: ${normalizeText(command?.id)}`,
    `Request: ${normalizeText(command?.text).slice(0, 500)}`,
    result?.prUrl ? `PR: ${result.prUrl}` : "",
    result?.mergeCommit ? `Merge commit: ${result.mergeCommit}` : "",
    result?.productionUrl ? `Live URL: ${result.productionUrl}` : "",
    result?.detail ? `Detail: ${result.detail}` : ""
  ].filter(Boolean).join("\n");
}
