import { BRIDGE_STATUS_STORAGE_KEY } from "./constants.js";
import {
  DISPATCH_MODE_LOCAL,
  DISPATCH_MODE_SLACK,
  getConfiguredDispatchMode,
  getDispatchModeLabel,
  isSlackDispatchConfigured
} from "./dispatch.js";
import { readCommands } from "./commands.js";
import { readRuntimeConfig } from "./config.js";

function normalizeDate(value) {
  const raw = String(value || "").trim();
  return raw || "";
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

export async function readBridgeStatus(env) {
  const runtimeConfig = await readRuntimeConfig(env);
  const raw = await env.LINKS_STORE.get(BRIDGE_STATUS_STORAGE_KEY, "json");
  const status = normalizeStatus(raw);

  if (!status.dispatchMode) {
    status.dispatchMode = getConfiguredDispatchMode(runtimeConfig);
  }

  if (!status.executorLabel) {
    status.executorLabel = getDispatchModeLabel(status.dispatchMode);
  }

  if (!raw && status.dispatchMode === DISPATCH_MODE_SLACK) {
    status.bridgeOnline = true;
    status.state = "idle";
  }

  if (status.dispatchMode === DISPATCH_MODE_LOCAL && !isSlackDispatchConfigured(runtimeConfig)) {
    status.executorLabel = "Cloud not configured; local bridge fallback";
    status.lastError = status.lastError || "Missing Slack secrets in Pages project.";
  }

  return status;
}

export async function writeBridgeStatus(env, input) {
  const runtimeConfig = await readRuntimeConfig(env);
  const status = normalizeStatus(input);
  const dispatchMode = status.dispatchMode || getConfiguredDispatchMode(runtimeConfig);
  status.dispatchMode = dispatchMode;
  status.executorLabel = status.executorLabel || (
    dispatchMode === DISPATCH_MODE_LOCAL && !isSlackDispatchConfigured(runtimeConfig)
      ? "Cloud not configured; local bridge fallback"
      : getDispatchModeLabel(dispatchMode)
  );
  await env.LINKS_STORE.put(BRIDGE_STATUS_STORAGE_KEY, JSON.stringify(status));
  return status;
}

export async function deriveBridgeStatusFromCommands(env, patch = {}) {
  const runtimeConfig = await readRuntimeConfig(env);
  const commands = await readCommands(env);
  const current = await readBridgeStatus(env);
  const active = commands
    .filter((command) => ["queued", "dispatched", "processing"].includes(String(command?.status || "").trim().toLowerCase()))
    .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
  const hasActive = active.length > 0;
  const derivedState = hasActive ? "running" : "idle";

  return normalizeStatus({
    ...current,
    ...patch,
    dispatchMode: patch.dispatchMode || current.dispatchMode || getConfiguredDispatchMode(runtimeConfig),
    executorLabel: patch.executorLabel || current.executorLabel || getDispatchModeLabel(patch.dispatchMode || current.dispatchMode),
    pendingCount: active.length,
    oldestPendingAt: active[0]?.createdAt || "",
    lastRunAt: patch.lastRunAt || current.lastRunAt,
    lastDispatchAt: patch.lastDispatchAt || current.lastDispatchAt,
    lastSuccessAt: patch.lastSuccessAt || current.lastSuccessAt,
    lastDeliveredCount: Number.isFinite(Number(patch.lastDeliveredCount))
      ? Number(patch.lastDeliveredCount)
      : current.lastDeliveredCount,
    bridgeOnline: typeof patch.bridgeOnline === "boolean" ? patch.bridgeOnline : current.bridgeOnline,
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
