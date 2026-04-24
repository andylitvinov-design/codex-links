import { createRemediationRun, advanceRemediationRun } from "../../_lib/remediation.js";
import { handleOptions, json } from "../../_lib/http.js";
import { readLatestDiagnosisRun } from "../../_lib/runs.js";

export async function onRequest(context) {
  const preflight = handleOptions(context.request);
  if (preflight) {
    return preflight;
  }

  if (context.request.method !== "POST") {
    return json({ error: "Method not allowed." }, { status: 405 });
  }

  let payload = {};
  try {
    payload = await context.request.json();
  } catch {
    payload = {};
  }

  const latest = await readLatestDiagnosisRun(context.env);
  const sourceDiagnosisId = String(payload?.sourceDiagnosisId || latest?.runId || "").trim();

  if (!sourceDiagnosisId) {
    return json({ error: "A completed diagnosis run is required before remediation." }, { status: 400 });
  }

  try {
    const run = await createRemediationRun(context.env, sourceDiagnosisId);
    const next = await advanceRemediationRun(context.env, run);
    return json(next, { status: 201 });
  } catch (error) {
    return json({
      error: String(error?.message || error || "Could not start remediation.").trim(),
      code: String(error?.code || "remediation_start_failed").trim()
    }, { status: Number(error?.status || 500) });
  }
}
