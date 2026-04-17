import { BRIDGE_STATUS_STORAGE_KEY } from "./constants.js";
import {
  DISPATCH_MODE_CLOUD,
  DISPATCH_MODE_LOCAL,
  DISPATCH_MODE_SLACK,
  getConfiguredDispatchMode,
  getDispatchModeLabel,
  isCloudDispatchConfigured,
  isSlackDispatchConfigured
} from "./dispatch.js";
import { readCommands } from "./commands.js";
import { readRuntimeConfig } from "./config.js";

export const BRIDGE_HEARTBEAT_STALE_MS = 75 * 1000;

function normalizeDate(value) {
  const raw = String(value || "").trim();
  return raw || "";
}

function isRecentTimestamp(value, maxAgeMs = BRIDGE_HEARTBEAT_STALE_MS) {
  const timestamp = Date.parse(String(value || "").trim());

  if (Number.isNaN(timestamp)) {
    return false;
  }

  return (Date.now() - timestamp) <= maxAgeMs;
}

function normalizeStatus(input) {
  if (!input || typeof input !== "object") {
    return {
      bridgeOnline: false,
      state: "unknown",
      dispatchMode: "",
      executorLabel: "",
      lastRunAt: "",
      lastDispatchAt: "",
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
    dispatchMode: String(input.dispatchMode || "").trim(),
    executorLabel: String(input.executorLabel || "").trim(),
    lastRunAt: normalizeDate(input.lastRunAt),
    lastDispatchAt: normalizeDate(input.lastDispatchAt),
    lastSuccessAt: normalizeDate(input.lastSuccessAt),
    pendingCount: Number.isFinite(Number(input.pendingCount)) ? Number(input.pendingCount) : 0,
    oldestPendingAt: normalizeDate(input.oldestPendingAt),
    lastDeliveredCount: Number.isFinite(Number(input.lastDeliveredCount)) ? Number(input.lastDeliveredCount) : 0,
    lastError: String(input.lastError || "").trim()
  };
}

export function isBridgeHeartbeatFresh(status, maxAgeMs = BRIDGE_HEARTBEAT_STALE_MS) {
  return isRecentTimestamp(status?.lastRunAt, maxAgeMs);
}

export function isLocalBridgeHealthy(status, maxAgeMs = BRIDGE_HEARTBEAT_STALE_MS) {
  if (String(status?.dispatchMode || "").trim() !== DISPATCH_MODE_LOCAL) {
    return false;
  }

  return Boolean(status?.bridgeOnline) && isBridgeHeartbeatFresh(status, maxAgeMs);
}

export async function readBridgeStatus(env) {
  const runtimeConfig = await readRuntimeConfig(env);
  const configuredDispatchMode = getConfiguredDispatchMode(runtimeConfig);
  const raw = await env.LINKS_STORE.get(BRIDGE_STATUS_STORAGE_KEY, "json");
  const status = normalizeStatus(raw);

  if (!status.dispatchMode || (
    configuredDispatchMode === DISPATCH_MODE_CLOUD
    && isCloudDispatchConfigured(runtimeConfig)
    && status.dispatchMode !== DISPATCH_MODE_CLOUD
  )) {
    status.dispatchMode = configuredDispatchMode;
  }

  if (!status.executorLabel || (
    status.dispatchMode === DISPATCH_MODE_CLOUD
    && status.executorLabel !== getDispatchModeLabel(DISPATCH_MODE_CLOUD)
  )) {
    status.executorLabel = getDispatchModeLabel(status.dispatchMode);
  }

  if (!raw && status.dispatchMode === DISPATCH_MODE_CLOUD) {
    status.bridgeOnline = true;
    status.state = "idle";
  }

  if (status.dispatchMode === DISPATCH_MODE_LOCAL && !isCloudDispatchConfigured(runtimeConfig)) {
    status.executorLabel = "Cloud not configured; local bridge fallback";
    status.lastError = status.lastError || "Missing OPENAI_API_KEY in Pages project.";
  }

  return status;
}

export async function writeBridgeStatus(env, input) {
  const runtimeConfig = await readRuntimeConfig(env);
  const status = normalizeStatus(input);
  const dispatchMode = status.dispatchMode || getConfiguredDispatchMode(runtimeConfig);
  status.dispatchMode = dispatchMode;
  status.executorLabel = status.executorLabel || (
    dispatchMode === DISPATCH_MODE_LOCAL && !isCloudDispatchConfigured(runtimeConfig)
      ? "Cloud not configured; local bridge fallback"
      : getDispatchModeLabel(dispatchMode)
  );
  await env.LINKS_STORE.put(BRIDGE_STATUS_STORAGE_KEY, JSON.stringify(status));
  return status;
}

export async function deriveBridgeStatusFromCommands(env, patch = {}) {
  const runtimeConfig = await readRuntimeConfig(env);
  const configuredDispatchMode = getConfiguredDispatchMode(runtimeConfig);
  const commands = await readCommands(env);
  const current = await readBridgeStatus(env);
  const active = commands
    .filter((command) => ["queued", "dispatched", "processing"].includes(String(command?.status || "").trim().toLowerCase()))
    .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
  const nextDispatchMode = patch.dispatchMode || configuredDispatchMode || current.dispatchMode;
  const localActive = active.filter((command) => command.dispatchMode === DISPATCH_MODE_LOCAL);
  const hasActive = active.length > 0;
  const freshHeartbeat = isBridgeHeartbeatFresh({
    ...current,
    ...patch,
    lastRunAt: patch.lastRunAt || current.lastRunAt
  });
  const bridgeOnline = typeof patch.bridgeOnline === "boolean"
    ? patch.bridgeOnline
    : nextDispatchMode === DISPATCH_MODE_CLOUD
      ? true
      : (current.bridgeOnline && freshHeartbeat);
  const derivedState = nextDispatchMode === DISPATCH_MODE_LOCAL && localActive.length > 0 && !bridgeOnline
    ? "stale"
    : hasActive
      ? "running"
      : "idle";

  return normalizeStatus({
    ...current,
    ...patch,
    dispatchMode: nextDispatchMode,
    executorLabel: patch.executorLabel || getDispatchModeLabel(nextDispatchMode),
    pendingCount: active.length,
    oldestPendingAt: active[0]?.createdAt || "",
    lastRunAt: patch.lastRunAt || current.lastRunAt,
    lastDispatchAt: patch.lastDispatchAt || current.lastDispatchAt,
    lastSuccessAt: patch.lastSuccessAt || current.lastSuccessAt,
    lastDeliveredCount: Number.isFinite(Number(patch.lastDeliveredCount))
      ? Number(patch.lastDeliveredCount)
      : current.lastDeliveredCount,
    bridgeOnline,
    state: typeof patch.state === "string" && patch.state.trim()
      ? String(patch.state).trim()
      : derivedState,
    lastError: typeof patch.lastError === "string" ? patch.lastError : current.lastError
  });
}

export async function refreshBridgeStatusFromCommands(env, patch = {}) {
  const status = await deriveBridgeStatusFromCommands(env, patch);
  return writeBridgeStatus(env, status);
}
