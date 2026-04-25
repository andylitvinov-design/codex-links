import { BRIDGE_STATUS_STORAGE_KEY } from "./constants.js";
import {
  DISPATCH_MODE_CLAUDE,
  DISPATCH_MODE_CLOUD,
  DISPATCH_MODE_LOCAL,
  DISPATCH_MODE_SLACK,
  getConfiguredDispatchMode,
  getDispatchModeLabel,
  isCloudDispatchConfigured,
  isSlackDispatchConfigured
} from "./dispatch.js";
import { readActiveCommands } from "./commands.js";
import { readRuntimeConfig } from "./config.js";

export const BRIDGE_HEARTBEAT_STALE_MS = 75 * 1000;

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeManagedBy(value) {
  const normalized = normalizeText(value).toLowerCase();
  return normalized || "";
}

function isLaunchdManaged(value) {
  return normalizeManagedBy(value) === "launchd";
}

function normalizeRunnerStatus(input) {
  if (!input || typeof input !== "object") {
    return {
      online: false,
      managedBy: "",
      state: "unknown",
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
    online: Boolean(input.online ?? input.bridgeOnline),
    managedBy: normalizeManagedBy(input.managedBy || input.supervisor),
    state: String(input.state || "unknown").trim() || "unknown",
    lastRunAt: normalizeDate(input.lastRunAt),
    lastDispatchAt: normalizeDate(input.lastDispatchAt),
    lastSuccessAt: normalizeDate(input.lastSuccessAt),
    pendingCount: Number.isFinite(Number(input.pendingCount)) ? Number(input.pendingCount) : 0,
    oldestPendingAt: normalizeDate(input.oldestPendingAt),
    lastDeliveredCount: Number.isFinite(Number(input.lastDeliveredCount)) ? Number(input.lastDeliveredCount) : 0,
    lastError: String(input.lastError || "").trim()
  };
}

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
      lastError: "",
      slackActor: normalizeSlackActorStatus(),
      localBridge: normalizeRunnerStatus(),
      claudeBridge: normalizeRunnerStatus()
    };
  }

  const localBridge = normalizeRunnerStatus(input.localBridge || input.codexBridge || {
    online: input.bridgeOnline,
    state: input.state,
    lastRunAt: input.lastRunAt,
    lastDispatchAt: input.lastDispatchAt,
    lastSuccessAt: input.lastSuccessAt,
    pendingCount: input.pendingCount,
    oldestPendingAt: input.oldestPendingAt,
    lastDeliveredCount: input.lastDeliveredCount,
    lastError: input.lastError
  });
  const claudeBridge = normalizeRunnerStatus(input.claudeBridge);

  return {
    bridgeOnline: Boolean(localBridge.online) && isLaunchdManaged(localBridge.managedBy),
    state: String(input.state || "unknown").trim() || "unknown",
    dispatchMode: String(input.dispatchMode || "").trim(),
    executorLabel: String(input.executorLabel || "").trim(),
    lastRunAt: normalizeDate(input.lastRunAt),
    lastDispatchAt: normalizeDate(input.lastDispatchAt),
    lastSuccessAt: normalizeDate(input.lastSuccessAt),
    pendingCount: Number.isFinite(Number(input.pendingCount)) ? Number(input.pendingCount) : 0,
    oldestPendingAt: normalizeDate(input.oldestPendingAt),
    lastDeliveredCount: Number.isFinite(Number(input.lastDeliveredCount)) ? Number(input.lastDeliveredCount) : 0,
    lastError: String(input.lastError || "").trim(),
    slackActor: normalizeSlackActorStatus(input.slackActor),
    localBridge,
    claudeBridge,
    routes: input.routes && typeof input.routes === "object" ? input.routes : undefined
  };
}

function pickOldestTimestamp(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => normalizeDate(value))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))[0] || "";
}

function getOldestActiveAt(commands) {
  return pickOldestTimestamp((Array.isArray(commands) ? commands : []).map((command) => command?.createdAt));
}

function routeHealth(input = {}) {
  const state = String(input.state || "").trim().toLowerCase();
  const normalizedState = state === "healthy" || state === "degraded" || state === "unavailable"
    ? state
    : "unavailable";

  return {
    state: normalizedState,
    enabled: Boolean(input.enabled),
    degradedReason: normalizeText(input.degradedReason),
    pendingCount: Number.isFinite(Number(input.pendingCount)) ? Number(input.pendingCount) : 0,
    oldestPendingAt: normalizeDate(input.oldestPendingAt),
    lastSuccessAt: normalizeDate(input.lastSuccessAt)
  };
}

export function buildRouteHealth(status, runtimeConfig = {}, activeCommands = []) {
  const source = status && typeof status === "object" ? status : {};
  const active = Array.isArray(activeCommands) ? activeCommands : [];
  const slackActive = active.filter((command) => command?.dispatchMode === DISPATCH_MODE_SLACK);
  const directActive = active.filter((command) => command?.dispatchMode === DISPATCH_MODE_CLOUD);
  const localActive = active.filter((command) => command?.dispatchMode === DISPATCH_MODE_LOCAL);
  const claudeActive = active.filter((command) => command?.dispatchMode === DISPATCH_MODE_CLAUDE);
  const slackConfigured = isSlackDispatchConfigured(runtimeConfig);
  const directConfigured = isCloudDispatchConfigured(runtimeConfig);
  const slackActorStatus = normalizeSlackActorStatus({
    ...source.slackActor,
    configuredUserId: runtimeConfig?.SLACK_CODEX_USER_ID || source.slackActor?.configuredUserId
  });
  const slackValidation = String(slackActorStatus.validationStatus || "").trim().toLowerCase();
  const localBridge = normalizeRunnerStatus(source.localBridge);
  const claudeBridge = normalizeRunnerStatus(source.claudeBridge);
  const localHealthy = Boolean(localBridge.online) && isLaunchdManaged(localBridge.managedBy);
  const claudeHealthy = Boolean(claudeBridge.online);
  const slackDegradedReason = !slackConfigured
    ? "Missing SLACK_BOT_TOKEN or SLACK_CODEX_CHANNEL_ID."
    : slackValidation !== "validated"
      ? (slackActorStatus.validationError || `Slack Codex actor is ${slackValidation || "unverified"}.`)
      : "";

  return {
    cloudViaSlack: routeHealth({
      state: !slackConfigured ? "unavailable" : (slackValidation === "validated" ? "healthy" : "degraded"),
      enabled: slackConfigured && slackValidation === "validated",
      degradedReason: slackDegradedReason,
      pendingCount: slackActive.length,
      oldestPendingAt: getOldestActiveAt(slackActive),
      lastSuccessAt: source.lastSuccessAt
    }),
    directOpenai: routeHealth({
      state: directConfigured ? "healthy" : "unavailable",
      enabled: directConfigured,
      degradedReason: directConfigured ? "" : "Missing OPENAI_API_KEY.",
      pendingCount: directActive.length,
      oldestPendingAt: getOldestActiveAt(directActive),
      lastSuccessAt: source.lastSuccessAt
    }),
    localBridge: routeHealth({
      state: localHealthy ? "healthy" : "unavailable",
      enabled: localHealthy,
      degradedReason: localHealthy ? "" : (localBridge.lastError || "Local bridge heartbeat is stale or not launchd-managed."),
      pendingCount: localActive.length || Number(localBridge.pendingCount || 0),
      oldestPendingAt: getOldestActiveAt(localActive) || localBridge.oldestPendingAt,
      lastSuccessAt: localBridge.lastSuccessAt
    }),
    claudeBridge: routeHealth({
      state: claudeHealthy ? "healthy" : "unavailable",
      enabled: claudeHealthy,
      degradedReason: claudeHealthy ? "" : (claudeBridge.lastError || "Claude bridge heartbeat is stale or unavailable."),
      pendingCount: claudeActive.length || Number(claudeBridge.pendingCount || 0),
      oldestPendingAt: getOldestActiveAt(claudeActive) || claudeBridge.oldestPendingAt,
      lastSuccessAt: claudeBridge.lastSuccessAt
    })
  };
}

function normalizeSlackActorStatus(input) {
  const source = input && typeof input === "object" ? input : {};
  const configuredUserId = normalizeText(source.configuredUserId || source.userId);
  const validationStatus = normalizeText(source.validationStatus || source.status).toLowerCase();
  const normalizedValidationStatus = validationStatus === "validated" || validationStatus === "invalid" || validationStatus === "unverified"
    ? validationStatus
    : (configuredUserId ? "unverified" : "invalid");

  return {
    configuredUserId,
    validationStatus: normalizedValidationStatus,
    lastValidatedAt: normalizeDate(source.lastValidatedAt),
    validationError: normalizeText(source.validationError || source.detail),
    probeChannelId: normalizeText(source.probeChannelId),
    probeMessageTs: normalizeText(source.probeMessageTs),
    probeThreadTs: normalizeText(source.probeThreadTs)
  };
}

export function isBridgeHeartbeatFresh(status, maxAgeMs = BRIDGE_HEARTBEAT_STALE_MS) {
  return isRecentTimestamp(status?.lastRunAt || status?.localBridge?.lastRunAt, maxAgeMs);
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
    && status.dispatchMode === DISPATCH_MODE_LOCAL
  )) {
    status.dispatchMode = configuredDispatchMode;
  }

  if (!status.executorLabel || (
    status.dispatchMode === DISPATCH_MODE_CLOUD
    && status.executorLabel !== getDispatchModeLabel(DISPATCH_MODE_CLOUD)
  )) {
    status.executorLabel = getDispatchModeLabel(status.dispatchMode);
  }

  if (status.dispatchMode === DISPATCH_MODE_LOCAL && !isCloudDispatchConfigured(runtimeConfig)) {
    status.executorLabel = "Cloud not configured; local bridge fallback";
    status.lastError = status.lastError || "Missing OPENAI_API_KEY in Pages project.";
  }

  status.slackActor = normalizeSlackActorStatus({
    ...status.slackActor,
    configuredUserId: runtimeConfig?.SLACK_CODEX_USER_ID || status.slackActor?.configuredUserId
  });
  status.bridgeOnline = Boolean(status.localBridge.online) && isLaunchdManaged(status.localBridge.managedBy);
  status.lastRunAt = status.localBridge.lastRunAt || status.lastRunAt;
  status.lastDispatchAt = status.localBridge.lastDispatchAt || status.lastDispatchAt;
  status.lastSuccessAt = status.localBridge.lastSuccessAt || status.lastSuccessAt;
  status.pendingCount = Math.max(Number(status.pendingCount || 0), Number(status.localBridge.pendingCount || 0));
  status.oldestPendingAt = status.oldestPendingAt || status.localBridge.oldestPendingAt;
  status.lastDeliveredCount = Math.max(Number(status.lastDeliveredCount || 0), Number(status.localBridge.lastDeliveredCount || 0));
  status.lastError = status.lastError || status.localBridge.lastError;
  status.routes = buildRouteHealth(status, runtimeConfig);

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
  const commands = await readActiveCommands(env);
  const current = await readBridgeStatus(env);
  const active = commands
    .filter((command) => ["queued", "dispatched", "processing"].includes(String(command?.status || "").trim().toLowerCase()))
    .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
  const nextDispatchMode = patch.dispatchMode || configuredDispatchMode || current.dispatchMode;
  const localActive = active.filter((command) => command.dispatchMode === DISPATCH_MODE_LOCAL);
  const claudeActive = active.filter((command) => command.dispatchMode === DISPATCH_MODE_CLAUDE);
  const hasActive = active.length > 0;
  const nextLocalBridge = normalizeRunnerStatus({
    ...current.localBridge,
    ...(patch.localBridge || {}),
    online: typeof patch.bridgeOnline === "boolean"
      ? patch.bridgeOnline
      : (patch.localBridge && typeof patch.localBridge.online === "boolean"
          ? patch.localBridge.online
          : current.localBridge.online),
    lastRunAt: patch.localBridge?.lastRunAt || patch.lastRunAt || current.localBridge.lastRunAt || current.lastRunAt,
    lastDispatchAt: patch.localBridge?.lastDispatchAt || current.localBridge.lastDispatchAt,
    lastSuccessAt: patch.localBridge?.lastSuccessAt || current.localBridge.lastSuccessAt,
    lastDeliveredCount: Number.isFinite(Number(patch.localBridge?.lastDeliveredCount))
      ? Number(patch.localBridge.lastDeliveredCount)
      : current.localBridge.lastDeliveredCount,
    lastError: typeof patch.localBridge?.lastError === "string" ? patch.localBridge.lastError : current.localBridge.lastError,
    pendingCount: localActive.length,
    oldestPendingAt: localActive[0]?.createdAt || ""
  });
  const nextClaudeBridge = normalizeRunnerStatus({
    ...current.claudeBridge,
    ...(patch.claudeBridge || {}),
    lastRunAt: patch.claudeBridge?.lastRunAt || current.claudeBridge.lastRunAt,
    pendingCount: claudeActive.length,
    oldestPendingAt: claudeActive[0]?.createdAt || ""
  });
  const freshLocalHeartbeat = isRecentTimestamp(nextLocalBridge.lastRunAt);
  const freshClaudeHeartbeat = isRecentTimestamp(nextClaudeBridge.lastRunAt);

  nextLocalBridge.online = Boolean(nextLocalBridge.online) && freshLocalHeartbeat;
  nextClaudeBridge.online = Boolean(nextClaudeBridge.online) && freshClaudeHeartbeat;
  const nextSlackActor = normalizeSlackActorStatus({
    ...current.slackActor,
    ...(patch.slackActor || {}),
    configuredUserId: patch.slackActor?.configuredUserId || current.slackActor?.configuredUserId || runtimeConfig?.SLACK_CODEX_USER_ID
  });

  const derivedState = hasActive ? "running" : "idle";

  return normalizeStatus({
    ...current,
    ...patch,
    dispatchMode: nextDispatchMode,
    executorLabel: patch.executorLabel || getDispatchModeLabel(nextDispatchMode),
    pendingCount: active.length,
    oldestPendingAt: active[0]?.createdAt || "",
    lastRunAt: nextLocalBridge.lastRunAt || current.lastRunAt,
    lastDispatchAt: patch.lastDispatchAt || current.lastDispatchAt,
    lastSuccessAt: patch.lastSuccessAt || current.lastSuccessAt,
    lastDeliveredCount: Number.isFinite(Number(patch.lastDeliveredCount))
      ? Number(patch.lastDeliveredCount)
      : current.lastDeliveredCount,
    bridgeOnline: Boolean(nextLocalBridge.online) && isLaunchdManaged(nextLocalBridge.managedBy),
    state: typeof patch.state === "string" && patch.state.trim()
      ? String(patch.state).trim()
      : derivedState,
    lastError: typeof patch.lastError === "string" ? patch.lastError : current.lastError,
    slackActor: nextSlackActor,
    localBridge: nextLocalBridge,
    claudeBridge: nextClaudeBridge,
    routes: buildRouteHealth({
      ...current,
      ...patch,
      slackActor: nextSlackActor,
      localBridge: nextLocalBridge,
      claudeBridge: nextClaudeBridge,
      lastSuccessAt: patch.lastSuccessAt || current.lastSuccessAt
    }, runtimeConfig, active)
  });
}

export async function refreshBridgeStatusFromCommands(env, patch = {}) {
  const status = await deriveBridgeStatusFromCommands(env, patch);
  return writeBridgeStatus(env, status);
}
