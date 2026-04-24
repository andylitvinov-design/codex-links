import { handleOptions, json } from "../_lib/http.js";
import { readLatestDiagnosisRun, readLatestRemediationRun } from "../_lib/runs.js";

function summarizeDiagnosis(run) {
  if (!run) {
    return null;
  }

  return {
    runId: run.runId,
    status: run.status,
    overallStatus: run.overallStatus,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    counts: run.counts,
    target: run.target
  };
}

function summarizeRemediation(run) {
  if (!run) {
    return null;
  }

  return {
    runId: run.runId,
    status: run.status,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    sourceDiagnosisId: run.sourceDiagnosisId,
    recheckId: run.recheckId,
    plan: run.plan
      ? {
          issueCount: run.plan.issueCount,
          autoFixCount: run.plan.autoFixCount,
          manualCount: run.plan.manualCount
        }
      : null,
    report: run.report
  };
}

export async function onRequest(context) {
  const preflight = handleOptions(context.request);
  if (preflight) {
    return preflight;
  }

  if (context.request.method !== "GET") {
    return json({ error: "Method not allowed." }, { status: 405 });
  }

  const [diagnosis, remediation] = await Promise.all([
    readLatestDiagnosisRun(context.env),
    readLatestRemediationRun(context.env)
  ]);

  return json({
    diagnosis: summarizeDiagnosis(diagnosis),
    remediation: summarizeRemediation(remediation)
  });
}
