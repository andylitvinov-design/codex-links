import { readAndAdvanceRemediationRun } from "../../_lib/remediation.js";
import { handleOptions, json } from "../../_lib/http.js";

export async function onRequest(context) {
  const preflight = handleOptions(context.request);
  if (preflight) {
    return preflight;
  }

  if (context.request.method !== "GET") {
    return json({ error: "Method not allowed." }, { status: 405 });
  }

  const runId = String(context.params?.runId || "").trim();
  const run = await readAndAdvanceRemediationRun(context.env, runId);

  if (!run) {
    return json({ error: "Remediation run not found." }, { status: 404 });
  }

  return json(run);
}
