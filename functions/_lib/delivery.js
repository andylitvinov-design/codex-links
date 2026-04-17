import {
  HISTORY_RETENTION_DAYS,
  SLACK_CHANNEL_ACTIVE_PREFIX,
  SLACK_THREAD_MAP_PREFIX
} from "./constants.js";

function normalizeSlackValue(rawValue) {
  return String(rawValue || "").trim().slice(0, 120);
}

function normalizeDateValue(rawValue) {
  return String(rawValue || "").trim().slice(0, 80);
}

function toTimestamp(value) {
  const timestamp = Date.parse(String(value || "").trim());
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function diffMs(start, end) {
  const startMs = toTimestamp(start);
  const endMs = toTimestamp(end);

  if (!startMs || !endMs || endMs < startMs) {
    return null;
  }

  return endMs - startMs;
}

export function normalizeLatencyFields(input = {}, command = {}) {
  const source = input && typeof input === "object" ? input : {};
  const fallback = command && typeof command === "object" ? command : {};

  return {
    uiSubmitStartedAt: normalizeDateValue(
      Object.prototype.hasOwnProperty.call(source, "uiSubmitStartedAt") ? source.uiSubmitStartedAt : fallback.uiSubmitStartedAt
    ),
    apiCommandsRequestStartedAt: normalizeDateValue(
      Object.prototype.hasOwnProperty.call(source, "apiCommandsRequestStartedAt") ? source.apiCommandsRequestStartedAt : fallback.apiCommandsRequestStartedAt
    ),
    commandCreatedAt: normalizeDateValue(
      Object.prototype.hasOwnProperty.call(source, "commandCreatedAt") ? source.commandCreatedAt : fallback.commandCreatedAt
    ),
    dispatchStartedAt: normalizeDateValue(
      Object.prototype.hasOwnProperty.call(source, "dispatchStartedAt") ? source.dispatchStartedAt : fallback.dispatchStartedAt
    ),
    slackPostedAt: normalizeDateValue(
      Object.prototype.hasOwnProperty.call(source, "slackPostedAt") ? source.slackPostedAt : fallback.slackPostedAt
    ),
    bridgeClaimedAt: normalizeDateValue(
      Object.prototype.hasOwnProperty.call(source, "bridgeClaimedAt") ? source.bridgeClaimedAt : fallback.bridgeClaimedAt
    ),
    firstExecutorAckSeenAt: normalizeDateValue(
      Object.prototype.hasOwnProperty.call(source, "firstExecutorAckSeenAt") ? source.firstExecutorAckSeenAt : fallback.firstExecutorAckSeenAt
    ),
    firstReplySeenAt: normalizeDateValue(
      Object.prototype.hasOwnProperty.call(source, "firstReplySeenAt") ? source.firstReplySeenAt : fallback.firstReplySeenAt
    ),
    replyIngestedAt: normalizeDateValue(
      Object.prototype.hasOwnProperty.call(source, "replyIngestedAt") ? source.replyIngestedAt : fallback.replyIngestedAt
    ),
    uiVisibleAt: normalizeDateValue(
      Object.prototype.hasOwnProperty.call(source, "uiVisibleAt") ? source.uiVisibleAt : fallback.uiVisibleAt
    )
  };
}

export function buildLatencyBreakdown(command) {
  const entry = command && typeof command === "object" ? command : {};

  return {
    uiToApiRequestMs: diffMs(entry.uiSubmitStartedAt, entry.apiCommandsRequestStartedAt),
    apiRequestToCommandCreatedMs: diffMs(entry.apiCommandsRequestStartedAt, entry.commandCreatedAt || entry.createdAt),
    commandCreateToDispatchStartMs: diffMs(entry.commandCreatedAt || entry.createdAt, entry.dispatchStartedAt),
    dispatchStartToSlackPostedMs: diffMs(entry.dispatchStartedAt, entry.slackPostedAt),
    dispatchStartToBridgeClaimMs: diffMs(entry.dispatchStartedAt, entry.bridgeClaimedAt),
    dispatchToFirstAckMs: diffMs(entry.dispatchStartedAt, entry.firstExecutorAckSeenAt),
    dispatchToFirstReplyMs: diffMs(entry.dispatchStartedAt, entry.firstReplySeenAt),
    firstReplyToIngestMs: diffMs(entry.firstReplySeenAt, entry.replyIngestedAt),
    ingestToUiVisibleMs: diffMs(entry.replyIngestedAt, entry.uiVisibleAt),
    uiToUiVisibleMs: diffMs(entry.uiSubmitStartedAt, entry.uiVisibleAt)
  };
}

export function getVisibleDeliveryStage(command) {
  const status = String(command?.status || "").trim().toLowerCase();
  const progressStage = String(command?.progressStage || "").trim().toLowerCase();

  if (status === "failed") {
    return "failed";
  }

  if (status === "answered" || status === "acked") {
    return "answered";
  }

  if (progressStage === "dispatching") {
    return "dispatching";
  }

  if (progressStage === "accepted") {
    return "accepted";
  }

  if (status === "processing" || progressStage === "processing") {
    return "processing";
  }

  if (status === "dispatched") {
    return command?.firstExecutorAckSeenAt ? "accepted" : "dispatching";
  }

  return "created";
}

function buildThreadMapKey(channelId, threadTs) {
  return `${SLACK_THREAD_MAP_PREFIX}${normalizeSlackValue(channelId)}:${normalizeSlackValue(threadTs)}`;
}

function buildActiveChannelKey(channelId) {
  return `${SLACK_CHANNEL_ACTIVE_PREFIX}${normalizeSlackValue(channelId)}`;
}

export async function storeSlackThreadCommandMap(env, channelId, threadTs, commandId) {
  const key = buildThreadMapKey(channelId, threadTs);
  const normalizedCommandId = String(commandId || "").trim();

  if (!normalizedCommandId || key.endsWith(":")) {
    return;
  }

  await env.LINKS_STORE.put(key, normalizedCommandId, {
    expirationTtl: HISTORY_RETENTION_DAYS * 24 * 60 * 60
  });
}

export async function getSlackThreadCommandId(env, channelId, threadTs) {
  const key = buildThreadMapKey(channelId, threadTs);

  if (key.endsWith(":")) {
    return "";
  }

  return String(await env.LINKS_STORE.get(key) || "").trim();
}

export async function storeSlackActiveChannelCommand(env, channelId, commandId) {
  const key = buildActiveChannelKey(channelId);
  const normalizedCommandId = String(commandId || "").trim();

  if (!normalizedCommandId || key.endsWith(":")) {
    return;
  }

  await env.LINKS_STORE.put(key, normalizedCommandId, {
    expirationTtl: HISTORY_RETENTION_DAYS * 24 * 60 * 60
  });
}

export async function getSlackActiveChannelCommandId(env, channelId) {
  const key = buildActiveChannelKey(channelId);

  if (key.endsWith(":")) {
    return "";
  }

  return String(await env.LINKS_STORE.get(key) || "").trim();
}

export async function clearSlackActiveChannelCommand(env, channelId, commandId = "") {
  const activeCommandId = await getSlackActiveChannelCommandId(env, channelId);
  const normalizedCommandId = String(commandId || "").trim();

  if (normalizedCommandId && activeCommandId && activeCommandId !== normalizedCommandId) {
    return;
  }

  const key = buildActiveChannelKey(channelId);

  if (key.endsWith(":")) {
    return;
  }

  await env.LINKS_STORE.delete(key);
}
