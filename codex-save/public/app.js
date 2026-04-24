const state = {
  diagnosis: null,
  remediation: null,
  remediationError: "",
  diagnosisPoller: null,
  remediationPoller: null
};

const runDiagnosisButton = document.querySelector("#run-diagnosis");
const runFixButton = document.querySelector("#run-fix");
const runRecheckButton = document.querySelector("#run-recheck");
const targetUrl = document.querySelector("#target-url");
const diagnosisStatus = document.querySelector("#diagnosis-status");
const remediationStatus = document.querySelector("#remediation-status");
const diagnosisMeta = document.querySelector("#diagnosis-meta");
const remediationMeta = document.querySelector("#remediation-meta");
const checks = document.querySelector("#checks");
const recommendations = document.querySelector("#recommendations");
const planSummary = document.querySelector("#plan-summary");
const report = document.querySelector("#report");

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatStatus(value) {
  const normalized = String(value || "unknown").trim().toLowerCase();
  if (normalized === "pass") return "pass";
  if (normalized === "degraded") return "degraded";
  if (normalized === "fail") return "fail";
  if (normalized === "blocked") return "blocked";
  return "unknown";
}

function formatStamp(value) {
  const timestamp = Date.parse(String(value || "").trim());
  return Number.isNaN(timestamp) ? "n/a" : new Date(timestamp).toLocaleString();
}

function clearTimer(timerId) {
  if (timerId) {
    clearTimeout(timerId);
  }
  return null;
}

function getDiagnosisPollDelay(run) {
  const startedAt = Date.parse(String(run?.createdAt || "").trim());
  if (Number.isNaN(startedAt)) {
    return 3000;
  }
  return (Date.now() - startedAt) <= 30000 ? 1000 : 3000;
}

function getRemediationPollDelay(run) {
  const startedAt = Date.parse(String(run?.createdAt || "").trim());
  const baseDelay = Number.isNaN(startedAt) || (Date.now() - startedAt) > 30000 ? 3500 : 1500;
  return run?.status === "rechecking" ? 1000 : baseDelay;
}

function isActiveRemediation(run) {
  return ["planning", "queued", "in_progress", "rechecking"].includes(String(run?.status || "").trim());
}

function getAutoFixChecks(run) {
  return (Array.isArray(run?.checks) ? run.checks : [])
    .filter((check) => check?.canAutoFix && !check?.manualRequired);
}

function getRunningChecks(run) {
  return (Array.isArray(run?.checks) ? run.checks : [])
    .filter((check) => check?.state === "running" || check?.state === "pending");
}

function renderDiagnosis() {
  const run = state.diagnosis;
  diagnosisStatus.textContent = run
    ? `${run.overallStatus} / ${run.status}`
    : "Нет данных";
  diagnosisMeta.textContent = run
    ? `runId ${run.runId} | ${Number(run.completedCount || 0)}/${Array.isArray(run.checks) ? run.checks.length : 0} checks | updated ${formatStamp(run.updatedAt)}`
    : "Нет активного прогона.";
  targetUrl.textContent = run?.target?.baseUrl || "https://codex-links.pages.dev";

  const list = Array.isArray(run?.checks) ? run.checks : [];
  if (!list.length) {
    checks.innerHTML = '<div class="note"><p>Диагностика ещё не запускалась.</p></div>';
    recommendations.innerHTML = '<div class="note"><p>Текстовые рекомендации появятся после завершения диагностики.</p></div>';
    runFixButton.disabled = true;
    return;
  }

  const autoFixChecks = getAutoFixChecks(run);
  runFixButton.disabled = run.status !== "completed" || autoFixChecks.length === 0 || isActiveRemediation(state.remediation);
  checks.innerHTML = list.map((check) => {
    const tokens = [];
    if (check.channel) tokens.push(`<span class="token">channel: ${escapeHtml(check.channel)}</span>`);
    if (check.route) tokens.push(`<span class="token">${escapeHtml(check.route)}</span>`);
    if (check.mode) tokens.push(`<span class="token">${escapeHtml(check.mode)}</span>`);
    if (check.expectedExecutor) tokens.push(`<span class="token">expected: ${escapeHtml(check.expectedExecutor)}</span>`);
    if (check.details?.actualExecutor) tokens.push(`<span class="token">actual: ${escapeHtml(check.details.actualExecutor)}</span>`);
    if (check.details?.createdDispatchMode || check.details?.dispatchMode) {
      tokens.push(`<span class="token">dispatch: ${escapeHtml(check.details.createdDispatchMode || check.details.dispatchMode)}</span>`);
    }
    if (check.fixCategory) tokens.push(`<span class="token">${escapeHtml(check.fixCategory)}</span>`);

    return `
      <article class="check-card">
        <div class="check-head">
          <div>
            <h3>${escapeHtml(check.label)}</h3>
            <p class="check-meta">${escapeHtml(check.group || "general")} • ${escapeHtml(check.state || "pending")}</p>
          </div>
          <span class="badge" data-status="${formatStatus(check.status)}">${escapeHtml(check.status || "unknown")}</span>
        </div>
        <p class="check-summary">${escapeHtml(check.summary || "")}</p>
        <div class="inline-list">${tokens.join("")}</div>
      </article>
    `;
  }).join("");

  const recommendationList = Array.isArray(run?.recommendations) ? run.recommendations : [];
  recommendations.innerHTML = recommendationList.length
    ? recommendationList.map((item) => `
      <article class="note" data-severity="${escapeHtml(item.severity || "info")}">
        <div class="note-head">
          <strong>${escapeHtml(item.title || "Recommendation")}</strong>
          <span class="badge" data-status="${item.actionType === "autofix" ? "degraded" : "blocked"}">${escapeHtml(item.actionType || "manual")}</span>
        </div>
        <p>${escapeHtml(item.summary || "")}</p>
        <p>${escapeHtml(item.recommendation || "")}</p>
      </article>
    `).join("")
    : '<div class="note"><p>Диагностика не выявила проблем. Отдельные рекомендации не нужны.</p></div>';
}

function renderRemediation() {
  const run = state.remediation;
  remediationStatus.textContent = run
    ? `${run.status}`
    : "Нет данных";
  remediationMeta.textContent = run
    ? `runId ${run.runId} | ${escapeHtml(run.recheckScope || "selective")} recheck | updated ${formatStamp(run.updatedAt)}`
    : "План исправлений ещё не запускался.";

  if (!run) {
    const diagnosis = state.diagnosis;
    const autoFixChecks = getAutoFixChecks(diagnosis);
    const runningChecks = getRunningChecks(diagnosis);
    let message = "Диагностика ещё не запускалась. Сначала нажмите `Диагностика`.";
    let detail = "";

    if (state.remediationError) {
      message = state.remediationError;
      detail = "Исправьте блокирующее состояние и повторите запуск.";
    } else if (isActiveRemediation(state.remediation)) {
      message = "Исправление уже запущено.";
      detail = "Дождитесь завершения agent command и selective recheck.";
    } else if (diagnosis?.status !== "completed" && runningChecks.length) {
      message = "Исправление пока недоступно: диагностика ещё выполняется.";
      detail = `Блокируют: ${runningChecks.map((check) => check.label || check.id).join(", ")}.`;
    } else if (diagnosis?.status === "completed" && autoFixChecks.length) {
      message = "Можно запускать исправление.";
      detail = `Auto-fix checks: ${autoFixChecks.map((check) => check.label || check.id).join(", ")}.`;
    } else if (diagnosis?.status === "completed") {
      message = "Автоматических исправлений нет.";
      detail = "Оставшиеся пункты требуют ручной проверки внешней конфигурации или платформенного ограничения.";
    }

    planSummary.innerHTML = `
      <article class="note">
        <div class="note-head">
          <strong>Remediation status</strong>
          <span class="badge" data-status="${autoFixChecks.length ? "degraded" : "unknown"}">${autoFixChecks.length ? "ready" : "waiting"}</span>
        </div>
        <p>${escapeHtml(message)}</p>
        ${detail ? `<p>${escapeHtml(detail)}</p>` : ""}
      </article>
    `;
    report.innerHTML = "";
    return;
  }

  const plan = run.plan || {};
  const issues = Array.isArray(plan.issues) ? plan.issues : [];
  const actions = Array.isArray(run.actions) ? run.actions : [];

  planSummary.innerHTML = `
    <article class="note">
      <div class="note-head">
        <strong>Plan</strong>
        <span class="badge" data-status="${formatStatus(state.diagnosis?.overallStatus)}">${escapeHtml(state.diagnosis?.overallStatus || "unknown")}</span>
      </div>
      <p>Issues: ${issues.length}. Auto-fix: ${Number(plan.autoFixCount || 0)}. Manual: ${Number(plan.manualCount || 0)}.</p>
      <p>Route: ${escapeHtml(actions[0]?.selectedDispatchMode || "n/a")} / ${escapeHtml(actions[0]?.selectedTargetExecutionMode || "n/a")} (${escapeHtml(actions[0]?.selectionReason || "n/a")}).</p>
      ${actions[0]?.commandId ? `<p>Command: ${escapeHtml(actions[0].commandId)} | Status: ${escapeHtml(actions[0]?.status || "queued")} | Actual executor: ${escapeHtml(actions[0]?.actualExecutor || "pending")}</p>` : ""}
      ${isActiveRemediation(run) ? "<p>Agent command is running. Code changes appear only after the command returns with PR/deploy references.</p>" : ""}
      ${actions[0]?.prUrl ? `<p>PR: <a href="${escapeHtml(actions[0].prUrl)}" target="_blank" rel="noreferrer">${escapeHtml(actions[0].prUrl)}</a></p>` : ""}
      ${actions[0]?.deployUrl ? `<p>Deploy: <a href="${escapeHtml(actions[0].deployUrl)}" target="_blank" rel="noreferrer">${escapeHtml(actions[0].deployUrl)}</a></p>` : ""}
      ${actions[0]?.branchName ? `<p>Branch: ${escapeHtml(actions[0].branchName)}</p>` : ""}
      <ul>
        ${issues.map((issue) => `<li>${escapeHtml(issue.label)}: ${escapeHtml(issue.summary)}</li>`).join("") || "<li>No issues.</li>"}
      </ul>
      <p>Actions: ${actions.map((action) => `${escapeHtml(action.kind)}${action.commandId ? ` ${escapeHtml(action.commandId)}` : ""}`).join(", ") || "none"}.</p>
    </article>
  `;

  if (!run.report) {
    report.innerHTML = '<div class="note"><p>Итоговый отчёт появится после завершения remediation и recheck.</p></div>';
    return;
  }

  const changes = Array.isArray(run.report.changes) ? run.report.changes : [];
  const unresolved = Array.isArray(run.report.unresolved) ? run.report.unresolved : [];
  report.innerHTML = `
    <article class="note">
      <div class="note-head">
        <strong>Report</strong>
        <span class="badge" data-status="${formatStatus(run.report.recheckSummary?.overallStatus)}">${escapeHtml(run.report.recheckSummary?.overallStatus || "unknown")}</span>
      </div>
      <p>Generated: ${escapeHtml(formatStamp(run.report.timestamp))}</p>
      <p>Recheck scope: ${escapeHtml(run.report.recheckScope || "selective")} (${escapeHtml((run.report.recheckedCheckIds || []).join(", ") || "none")})</p>
      <p>Changes:</p>
      <ul>
        ${changes.map((change) => `<li>${escapeHtml(change.label)}: ${escapeHtml(change.before)} -> ${escapeHtml(change.after)}</li>`).join("") || "<li>No status changes.</li>"}
      </ul>
      <p>Unresolved:</p>
      <ul>
        ${unresolved.map((item) => `<li>${escapeHtml(item.label)}: ${escapeHtml(item.summary)}</li>`).join("") || "<li>None.</li>"}
      </ul>
    </article>
  `;
}

function render() {
  renderDiagnosis();
  renderRemediation();
}

async function readJson(url, init) {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(data?.error || data?.message || `HTTP ${response.status}`).trim());
  }
  return data;
}

function stopPollers() {
  state.diagnosisPoller = clearTimer(state.diagnosisPoller);
  state.remediationPoller = clearTimer(state.remediationPoller);
}

function startDiagnosisPolling(runId) {
  state.diagnosisPoller = clearTimer(state.diagnosisPoller);

  const tick = async () => {
    const next = await readJson(`/api/diagnostics/${encodeURIComponent(runId)}`);
    state.diagnosis = next;
    render();

    if (next.status === "completed" || next.status === "failed") {
      state.diagnosisPoller = null;
      return;
    }

    state.diagnosisPoller = setTimeout(tick, getDiagnosisPollDelay(next));
  };

  state.diagnosisPoller = setTimeout(tick, 0);
}

function startRemediationPolling(runId) {
  state.remediationPoller = clearTimer(state.remediationPoller);

  const tick = async () => {
    const next = await readJson(`/api/remediation/${encodeURIComponent(runId)}`);
    state.remediation = next;
    if (next.recheckId) {
      state.diagnosis = await readJson(`/api/diagnostics/${encodeURIComponent(next.recheckId)}`);
    }
    render();

    if (next.status === "completed" || next.status === "failed" || next.status === "manual_required" || next.status === "not_needed") {
      state.remediationPoller = null;
      return;
    }

    state.remediationPoller = setTimeout(tick, getRemediationPollDelay(next));
  };

  state.remediationPoller = setTimeout(tick, 0);
}

async function loadSummary() {
  const summary = await readJson("/api/health-summary");
  state.diagnosis = summary.diagnosis
    ? await readJson(`/api/diagnostics/${encodeURIComponent(summary.diagnosis.runId)}`)
    : null;
  state.remediation = summary.remediation
    ? await readJson(`/api/remediation/${encodeURIComponent(summary.remediation.runId)}`)
    : null;
  render();
}

runDiagnosisButton.addEventListener("click", async () => {
  const run = await readJson("/api/diagnostics/run", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({
      reason: "manual-diagnosis"
    })
  });
  state.diagnosis = run;
  state.remediation = null;
  state.remediationError = "";
  render();
  startDiagnosisPolling(run.runId);
});

runRecheckButton.addEventListener("click", async () => {
  const run = await readJson("/api/diagnostics/run", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({
      reason: "manual-full-recheck",
      scope: "full"
    })
  });
  state.diagnosis = run;
  render();
  startDiagnosisPolling(run.runId);
});

runFixButton.addEventListener("click", async () => {
  if (!state.diagnosis?.runId) {
    return;
  }

  try {
    state.remediationError = "";
    const run = await readJson("/api/remediation/run", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({
        sourceDiagnosisId: state.diagnosis.runId
      })
    });
    state.remediation = run;
    render();
    startRemediationPolling(run.runId);
  } catch (error) {
    state.remediation = null;
    state.remediationError = String(error?.message || error || "Не удалось запустить исправление.");
    render();
  }
});

window.addEventListener("beforeunload", stopPollers);

loadSummary().catch((error) => {
  diagnosisStatus.textContent = String(error?.message || error || "Failed to load summary.");
});
