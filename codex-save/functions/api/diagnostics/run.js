import { createDiagnosisRun, advanceDiagnosisRun } from "../../_lib/diagnostics.js";
import { handleOptions, json } from "../../_lib/http.js";

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

  const run = await createDiagnosisRun(context.env, payload);
  const next = await advanceDiagnosisRun(context.env, run);
  return json(next, { status: 201 });
}
