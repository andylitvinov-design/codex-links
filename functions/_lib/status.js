import { BRIDGE_STATUS_STORAGE_KEY } from "./constants.js";

function normalizeDate(value) {
  const raw = String(value || "").trim();
  return raw || "";
}

function normalizeStatus(input) {
  if (!input || typeof input !== "object") {
    return {
      bridgeOnline: false,
      state: "unknown",
      lastRunAt: "",
      lastSuccessAt: "",
      pendingCount: 0,
      oldestPendingAt: "",
      lastDeliveredCount: 0,
      lastError: ""
    };
  }

  return {
    bridgeOnline: Boolean(input.bridgeOnline),
    state: String(input.state || "unknown").trim() || "unknown",
    lastRunAt: normalizeDate(input.lastRunAt),
    lastSuccessAt: normalizeDate(input.lastSuccessAt),
    pendingCount: Number.isFinite(Number(input.pendingCount)) ? Number(input.pendingCount) : 0,
    oldestPendingAt: normalizeDate(input.oldestPendingAt),
    lastDeliveredCount: Number.isFinite(Number(input.lastDeliveredCount)) ? Number(input.lastDeliveredCount) : 0,
    lastError: String(input.lastError || "").trim()
  };
}

export async function readBridgeStatus(env) {
  const raw = await env.LINKS_STORE.get(BRIDGE_STATUS_STORAGE_KEY, "json");
  return normalizeStatus(raw);
}

export async function writeBridgeStatus(env, input) {
  const status = normalizeStatus(input);
  await env.LINKS_STORE.put(BRIDGE_STATUS_STORAGE_KEY, JSON.stringify(status));
  return status;
}
