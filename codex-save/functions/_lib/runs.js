import {
  DIAGNOSIS_RUN_PREFIX,
  LATEST_DIAGNOSIS_KEY,
  LATEST_REMEDIATION_KEY,
  REMEDIATION_RUN_PREFIX
} from "./constants.js";
import { readJson, readLatestId, writeJson, writeLatestId } from "./storage.js";

function ensureIso(value) {
  const parsed = Date.parse(String(value || "").trim());
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

export async function saveDiagnosisRun(env, run) {
  const next = {
    ...run,
    updatedAt: ensureIso(run?.updatedAt || new Date().toISOString())
  };
  await writeJson(env, `${DIAGNOSIS_RUN_PREFIX}${next.runId}`, next);
  await writeLatestId(env, LATEST_DIAGNOSIS_KEY, next.runId);
  return next;
}

export async function readDiagnosisRun(env, runId) {
  if (!String(runId || "").trim()) {
    return null;
  }
  return readJson(env, `${DIAGNOSIS_RUN_PREFIX}${String(runId).trim()}`);
}

export async function readLatestDiagnosisRun(env) {
  const id = await readLatestId(env, LATEST_DIAGNOSIS_KEY);
  return id ? readDiagnosisRun(env, id) : null;
}

export async function saveRemediationRun(env, run) {
  const next = {
    ...run,
    updatedAt: ensureIso(run?.updatedAt || new Date().toISOString())
  };
  await writeJson(env, `${REMEDIATION_RUN_PREFIX}${next.runId}`, next);
  await writeLatestId(env, LATEST_REMEDIATION_KEY, next.runId);
  return next;
}

export async function readRemediationRun(env, runId) {
  if (!String(runId || "").trim()) {
    return null;
  }
  return readJson(env, `${REMEDIATION_RUN_PREFIX}${String(runId).trim()}`);
}

export async function readLatestRemediationRun(env) {
  const id = await readLatestId(env, LATEST_REMEDIATION_KEY);
  return id ? readRemediationRun(env, id) : null;
}
