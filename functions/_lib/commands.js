import {
  COMMAND_PROCESSING_LEASE_MS,
  COMMAND_ACTIVE_STORAGE_KEY,
  COMMAND_CLIENT_INDEX_PREFIX,
  COMMAND_ITEM_PREFIX,
  COMMAND_LOCAL_PROCESSING_STORAGE_KEY,
  COMMAND_LOCAL_QUEUE_STORAGE_KEY,
  COMMANDS_STORAGE_KEY,
  COMMANDS_RECENT_STORAGE_KEY,
  HISTORY_RETENTION_MS,
  MAX_COMMANDS
} from "./constants.js";
import { DISPATCH_MODE_CLOUD, DISPATCH_MODE_LOCAL, DISPATCH_MODE_SLACK, normalizeDispatchMode } from "./dispatch.js";
import { parseCommandError, stringifyCommandError } from "./command-debug.js";
import { normalizeLatencyFields } from "./delivery.js";

const RECENT_DUPLICATE_WINDOW_MS = 5 * 60 * 1000;
const SUPERSEDED_DUPLICATE_WINDOW_MS = 15 * 60 * 1000;
const CLOUD_FIRST_ACK_TIMEOUT_MS = 5 * 1000;
const CLOUD_RESULT_TIMEOUT_MS = 180 * 1000;
const BRIDGE_CLAIM_TIMEOUT_MS = 15 * 1000;
const BRIDGE_RESULT_TIMEOUT_MS = 120 * 1000;

export const COMMAND_TIMEOUTS = {
  cloudFirstAckMs: CLOUD_FIRST_ACK_TIMEOUT_MS,
  cloudResultMs: CLOUD_RESULT_TIMEOUT_MS,
  bridgeClaimMs: BRIDGE_CLAIM_TIMEOUT_MS,
  bridgeResultMs: BRIDGE_RESULT_TIMEOUT_MS
};

function commandItemKey(id) {
  return `${COMMAND_ITEM_PREFIX}${String(id || "").trim()}`;
}

function commandClientIndexKey(clientId) {
  return `${COMMAND_CLIENT_INDEX_PREFIX}${normalizeClientId(clientId)}`;
}

function uniqIds(ids, max = MAX_COMMANDS) {
  return [...new Set(
    (Array.isArray(ids) ? ids : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  )].slice(-max);
}

function isKvRateLimitError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("429")
    && message.includes("kv")
    && (message.includes("limit") || message.includes("rate"));
}

async function readIdIndex(env, key) {
  try {
    const existing = await env.LINKS_STORE.get(key, "json");
    return uniqIds(existing);
  } catch (error) {
    if (isKvRateLimitError(error)) {
      error.kvRateLimited = true;
    }
    throw error;
  }
}

async function writeIdIndex(env, key, ids) {
  await env.LINKS_STORE.put(key, JSON.stringify(uniqIds(ids)));
}

async function readStoredCommand(env, id) {
  const normalizedId = String(id || "").trim();

  if (!normalizedId) {
    return null;
  }

  const entry = await env.LINKS_STORE.get(commandItemKey(normalizedId), "json");
  return entry && typeof entry === "object" ? entry : null;
}

async function readStoredCommandsByIds(env, ids) {
  const normalizedIds = uniqIds(ids);
  const entries = await Promise.all(normalizedIds.map((id) => readStoredCommand(env, id)));
  return entries.filter(Boolean);
}

function isActiveCommandStatus(status) {
  const normalized = normalizeCommandStatus(status);
  return normalized === "queued" || normalized === "dispatched" || normalized === "processing";
}

function isLocalQueueCommand(command) {
  return command?.dispatchMode === DISPATCH_MODE_LOCAL && normalizeCommandStatus(command?.status) === "queued";
}

function isLocalProcessingCommand(command) {
  return command?.dispatchMode === DISPATCH_MODE_LOCAL && normalizeCommandStatus(command?.status) === "processing";
}

async function appendIndexedCommandId(env, key, id) {
  const normalizedId = String(id || "").trim();

  if (!normalizedId) {
    return;
  }

  const current = await readIdIndex(env, key).catch(() => []);
  await writeIdIndex(env, key, [...current, normalizedId]);
}

async function rebuildCommandIndexes(env, commands) {
  const normalized = (Array.isArray(commands) ? commands : [])
    .map((command) => compactCommandForStorage(command))
    .filter((command) => isWithinRetentionWindow(command?.createdAt))
    .slice(-MAX_COMMANDS);

  const recentIds = [];
  const activeIds = [];
  const localQueueIds = [];
  const localProcessingIds = [];
  const clientIds = new Map();

  for (const command of normalized) {
    if (!command?.id) {
      continue;
    }

    await env.LINKS_STORE.put(commandItemKey(command.id), JSON.stringify(command));
    recentIds.push(command.id);

    const clientId = normalizeClientId(command.clientId);
    if (clientId) {
      const bucket = clientIds.get(clientId) || [];
      bucket.push(command.id);
      clientIds.set(clientId, bucket);
    }

    if (isActiveCommandStatus(command.status)) {
      activeIds.push(command.id);
    }

    if (isLocalQueueCommand(command)) {
      localQueueIds.push(command.id);
    }

    if (isLocalProcessingCommand(command)) {
      localProcessingIds.push(command.id);
    }
  }

  await Promise.all([
    writeIdIndex(env, COMMANDS_RECENT_STORAGE_KEY, recentIds),
    writeIdIndex(env, COMMAND_ACTIVE_STORAGE_KEY, activeIds),
    writeIdIndex(env, COMMAND_LOCAL_QUEUE_STORAGE_KEY, localQueueIds),
    writeIdIndex(env, COMMAND_LOCAL_PROCESSING_STORAGE_KEY, localProcessingIds),
    ...[...clientIds.entries()].map(([clientId, ids]) => writeIdIndex(env, commandClientIndexKey(clientId), ids))
  ]);
}

async function persistCommand(env, command) {
  if (!command?.id) {
    return command;
  }

  const normalized = compactCommandForStorage(command);
  await env.LINKS_STORE.put(commandItemKey(normalized.id), JSON.stringify(normalized));
  await appendIndexedCommandId(env, COMMANDS_RECENT_STORAGE_KEY, normalized.id);
  await appendIndexedCommandId(env, commandClientIndexKey(normalized.clientId), normalized.id);

  const [activeIds, queueIds, processingIds] = await Promise.all([
    readIdIndex(env, COMMAND_ACTIVE_STORAGE_KEY).catch(() => []),
    readIdIndex(env, COMMAND_LOCAL_QUEUE_STORAGE_KEY).catch(() => []),
    readIdIndex(env, COMMAND_LOCAL_PROCESSING_STORAGE_KEY).catch(() => [])
  ]);

  await Promise.all([
    writeIdIndex(
      env,
      COMMAND_ACTIVE_STORAGE_KEY,
      isActiveCommandStatus(normalized.status)
        ? [...activeIds, normalized.id]
        : activeIds.filter((id) => id !== normalized.id)
    ),
    writeIdIndex(
      env,
      COMMAND_LOCAL_QUEUE_STORAGE_KEY,
      isLocalQueueCommand(normalized)
        ? [...queueIds, normalized.id]
        : queueIds.filter((id) => id !== normalized.id)
    ),
    writeIdIndex(
      env,
      COMMAND_LOCAL_PROCESSING_STORAGE_KEY,
      isLocalProcessingCommand(normalized)
        ? [...processingIds, normalized.id]
        : processingIds.filter((id) => id !== normalized.id)
    )
  ]);

  return normalized;
}

function normalizeCommandStatus(rawStatus) {
  const status = String(rawStatus || "").trim().toLowerCase();

  if (status === "pending") {
    return "queued";
  }

  if (
    status === "queued"
    || status === "dispatched"
    || status === "processing"
    || status === "answered"
    || status === "failed"
    || status === "acked"
  ) {
    return status;
  }

  return "queued";
}

function normalizeProgressStage(rawStage) {
  return String(rawStage || "").trim().slice(0, 80);
}

function normalizeProgressUpdatedAt(rawValue) {
  return String(rawValue || "").trim().slice(0, 80);
}

function normalizeText(rawText) {
  return sanitizeCommandText(String(rawText || "")).slice(0, 2000);
}

function canonicalizeText(rawText) {
  return normalizeText(rawText).replace(/\s+/g, " ").trim().toLowerCase();
}

function sanitizeCommandText(rawText) {
  const text = String(rawText || "").replace(/\r/g, "").trim();

  if (!text) {
    return "";
  }

  // If the mobile browser pasted the visible chat transcript into the textarea,
  // extract only the latest user message instead of replaying the whole page.
  if (/(^|\n)(Codex|Вы)\n\d{1,2}\s[\s\S]+?\n/.test(text) && /Ответ Codex/.test(text)) {
    const parts = text.split(/\nВы\n\d{1,2}\s.+?\n/g).map((entry) => entry.trim()).filter(Boolean);

    if (parts.length) {
      return parts[parts.length - 1] || "";
    }
  }

  return text;
}

function normalizeClientId(rawClientId) {
  return String(rawClientId || "").trim().slice(0, 120);
}

function normalizeThreadId(rawThreadId) {
  return String(rawThreadId || "").trim().slice(0, 160);
}

function normalizeThreadLabel(rawThreadLabel, threadId) {
  const value = String(rawThreadLabel || "").trim().slice(0, 120);
  return value || threadId || "Links";
}

function normalizeFallbackThreadId(rawThreadId) {
  return normalizeThreadId(rawThreadId);
}

function normalizeFallbackThreadLabel(rawThreadLabel, threadId) {
  return normalizeThreadLabel(rawThreadLabel, threadId);
}

function normalizeDispatchValue(rawDispatchMode) {
  return normalizeDispatchMode(rawDispatchMode || DISPATCH_MODE_LOCAL);
}

function normalizeSlackValue(rawValue) {
  return String(rawValue || "").trim().slice(0, 120);
}

function normalizeRepoValue(rawValue) {
  return String(rawValue || "").trim().slice(0, 240).toLowerCase();
}

function normalizeUrlValue(rawValue) {
  return String(rawValue || "").trim().slice(0, 400);
}

function normalizeWorkspacePathValue(rawValue) {
  return String(rawValue || "").trim().slice(0, 500);
}

function normalizeStringArray(rawValue, maxItems = 8, maxLength = 80) {
  return [...new Set(
    (Array.isArray(rawValue) ? rawValue : [])
      .map((value) => String(value || "").trim().slice(0, maxLength))
      .filter(Boolean)
  )].slice(0, maxItems);
}

function normalizeErrorMessage(rawValue) {
  const value = String(rawValue || "").trim().slice(0, 500);
  const parsed = parseCommandError(value);
  return parsed ? stringifyCommandError(parsed) : value;
}

function normalizeDateValue(rawValue) {
  return String(rawValue || "").trim().slice(0, 80);
}

function normalizeExecutionMode(rawValue) {
  return String(rawValue || "").trim().toLowerCase() === "cloud" ? "cloud" : "bridge";
}

function normalizeCommandMode(rawValue) {
  return String(rawValue || "").trim().toLowerCase() === "compat" ? "compat" : "default";
}

function normalizeActualExecutionMode(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  return value === "cloud" || value === "bridge" ? value : "";
}

function normalizeCloudJobId(rawValue) {
  return String(rawValue || "").trim().slice(0, 160);
}

function normalizeProgressMessage(rawValue) {
  return String(rawValue || "").trim().slice(0, 240);
}

function normalizeReplyMatchedBy(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();

  if (value === "thread" || value === "unthreaded-fallback" || value === "manual-sync" || value === "direct-api") {
    return value;
  }

  return "";
}

function dispatchModeToExecutionMode(rawValue) {
  return normalizeDispatchValue(rawValue) === DISPATCH_MODE_LOCAL ? "bridge" : "cloud";
}

function normalizeBooleanValue(rawValue, fallback = false) {
  return typeof rawValue === "boolean" ? rawValue : fallback;
}

function normalizeDiagnosticText(rawValue, max = 240) {
  return String(rawValue || "").trim().slice(0, max);
}

function normalizePhotoUnsupportedReason(rawValue) {
  return normalizeDiagnosticText(rawValue, 240);
}

function normalizeDeliveryEvidence(rawValue) {
  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }

  const normalized = {
    inspectedAt: normalizeDateValue(rawValue.inspectedAt),
    slackRootPosted: normalizeBooleanValue(rawValue.slackRootPosted, normalizeBooleanValue(rawValue.threadRootSeen)),
    slackThreadMapped: normalizeBooleanValue(rawValue.slackThreadMapped),
    slackPhotoUploaded: normalizeBooleanValue(rawValue.slackPhotoUploaded, normalizeBooleanValue(rawValue.fileReplySeen, Boolean(rawValue.fileId))),
    slackFileVisible: normalizeBooleanValue(
      rawValue.slackFileVisible,
      normalizeDiagnosticText(rawValue.fileAccess, 40).toLowerCase() === "visible"
    ),
    slackFileOpenOk: typeof rawValue.slackFileOpenOk === "boolean"
      ? rawValue.slackFileOpenOk
      : (typeof rawValue.botCanOpenFile === "boolean" ? rawValue.botCanOpenFile : false),
    workerReplySeen: normalizeBooleanValue(rawValue.workerReplySeen),
    workerAckSeen: normalizeBooleanValue(rawValue.workerAckSeen, normalizeBooleanValue(rawValue.executionAckSeen)),
    workerPhotoReadySeen: normalizeBooleanValue(rawValue.workerPhotoReadySeen, normalizeBooleanValue(rawValue.photoReadySeen)),
    slackRootPostedAt: normalizeDateValue(rawValue.slackRootPostedAt),
    slackThreadMappedAt: normalizeDateValue(rawValue.slackThreadMappedAt),
    slackPhotoUploadedAt: normalizeDateValue(rawValue.slackPhotoUploadedAt),
    slackFileVisibleAt: normalizeDateValue(rawValue.slackFileVisibleAt),
    slackFileOpenOkAt: normalizeDateValue(rawValue.slackFileOpenOkAt),
    workerReplySeenAt: normalizeDateValue(rawValue.workerReplySeenAt),
    workerAckSeenAt: normalizeDateValue(rawValue.workerAckSeenAt),
    workerPhotoReadySeenAt: normalizeDateValue(rawValue.workerPhotoReadySeenAt),
    matchedChannelId: normalizeSlackValue(rawValue.matchedChannelId),
    matchedThreadTs: normalizeSlackValue(rawValue.matchedThreadTs),
    threadRootSeen: normalizeBooleanValue(rawValue.threadRootSeen),
    uploadNoticeSeen: normalizeBooleanValue(rawValue.uploadNoticeSeen),
    fileReplySeen: normalizeBooleanValue(rawValue.fileReplySeen),
    fileId: normalizeSlackValue(rawValue.fileId),
    fileMode: normalizeDiagnosticText(rawValue.fileMode, 40),
    fileAccess: normalizeDiagnosticText(rawValue.fileAccess, 40),
    botCanOpenFile: typeof rawValue.botCanOpenFile === "boolean" ? rawValue.botCanOpenFile : null,
    botOpenHttpStatus: Number.isFinite(Number(rawValue.botOpenHttpStatus)) ? Number(rawValue.botOpenHttpStatus) : 0,
    executionAckSeen: normalizeBooleanValue(rawValue.executionAckSeen),
    photoReadySeen: normalizeBooleanValue(rawValue.photoReadySeen)
  };

  if (
    !normalized.inspectedAt
    && !normalized.slackRootPosted
    && !normalized.slackThreadMapped
    && !normalized.slackPhotoUploaded
    && !normalized.slackFileVisible
    && !normalized.slackFileOpenOk
    && !normalized.workerReplySeen
    && !normalized.workerAckSeen
    && !normalized.workerPhotoReadySeen
    && !normalized.slackRootPostedAt
    && !normalized.slackThreadMappedAt
    && !normalized.slackPhotoUploadedAt
    && !normalized.slackFileVisibleAt
    && !normalized.slackFileOpenOkAt
    && !normalized.workerReplySeenAt
    && !normalized.workerAckSeenAt
    && !normalized.workerPhotoReadySeenAt
    && !normalized.matchedChannelId
    && !normalized.matchedThreadTs
    && !normalized.threadRootSeen
    && !normalized.uploadNoticeSeen
    && !normalized.fileReplySeen
    && !normalized.fileId
    && !normalized.fileMode
    && !normalized.fileAccess
    && normalized.botCanOpenFile === null
    && !normalized.botOpenHttpStatus
    && !normalized.executionAckSeen
    && !normalized.photoReadySeen
  ) {
    return null;
  }

  return normalized;
}

function normalizeRouteAttempt(input = {}) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const at = normalizeDateValue(input.at || input.timestamp);
  const mode = normalizeDiagnosticText(input.mode || input.dispatchMode, 40);
  const stage = normalizeProgressStage(input.stage);

  if (!at || !mode || !stage) {
    return null;
  }

  return {
    at,
    mode,
    stage,
    slackChannelId: normalizeSlackValue(input.slackChannelId),
    slackThreadTs: normalizeSlackValue(input.slackThreadTs),
    slackMessageTs: normalizeSlackValue(input.slackMessageTs),
    fallbackReason: normalizeDiagnosticText(input.fallbackReason),
    diagnosticCode: normalizeDiagnosticText(input.diagnosticCode || input.lastDiagnosticCode, 80),
    diagnosticDetail: normalizeDiagnosticText(input.diagnosticDetail || input.lastDiagnosticDetail, 240),
    photoFileId: normalizeSlackValue(input.photoFileId),
    photoPermalink: normalizeUrlValue(input.photoPermalink)
  };
}

function normalizeRouteAttempts(rawValue) {
  return (Array.isArray(rawValue) ? rawValue : [])
    .map((entry) => normalizeRouteAttempt(entry))
    .filter(Boolean)
    .slice(-12);
}

function appendRouteAttempt(command, input = {}, nowIso = new Date().toISOString()) {
  const nextAttempt = normalizeRouteAttempt({
    at: input.at || nowIso,
    mode: input.mode || input.dispatchMode || command?.dispatchMode,
    stage: input.stage,
    slackChannelId: input.slackChannelId,
    slackThreadTs: input.slackThreadTs,
    slackMessageTs: input.slackMessageTs,
    fallbackReason: input.fallbackReason,
    diagnosticCode: input.diagnosticCode,
    diagnosticDetail: input.diagnosticDetail,
    photoFileId: input.photoFileId,
    photoPermalink: input.photoPermalink
  });

  if (!nextAttempt) {
    return normalizeRouteAttempts(command?.routeAttempts);
  }

  return normalizeRouteAttempts([...(Array.isArray(command?.routeAttempts) ? command.routeAttempts : []), nextAttempt]);
}

function derivePhotoAttached(command, input = {}) {
  if (typeof input.photoAttached === "boolean") {
    return input.photoAttached;
  }

  if (typeof command?.photoAttached === "boolean") {
    return command.photoAttached;
  }

  return Boolean(command?.photo);
}

function derivePhotoBytesPresent(command, input = {}) {
  if (typeof input.photoBytesPresent === "boolean") {
    return input.photoBytesPresent;
  }

  if (typeof command?.photoBytesPresent === "boolean") {
    return command.photoBytesPresent;
  }

  return Boolean(String(command?.photo?.dataUrl || "").trim());
}

function mergeCommandDebugState(command, input = {}, dispatchMode = input.dispatchMode || command?.dispatchMode) {
  const actualDispatchMode = dispatchModeToExecutionMode(dispatchMode);
  const requestedExecutor = normalizeExecutionMode(
    input.requestedExecutor
      || input.requestedMode
      || command?.requestedExecutor
      || command?.requestedMode
      || command?.targetExecutionMode
  );
  const normalizedActualExecutor = normalizeActualExecutionMode(
    Object.prototype.hasOwnProperty.call(input, "actualExecutor")
      ? input.actualExecutor
      : (Object.prototype.hasOwnProperty.call(input, "actualDispatchMode")
          ? input.actualDispatchMode
          : (command?.actualExecutor || command?.actualDispatchMode))
  );
  const replyMatched = normalizeBooleanValue(
    Object.prototype.hasOwnProperty.call(input, "replyMatched") ? input.replyMatched : input.slackReplyMatched,
    Boolean(command?.replyMatched ?? command?.slackReplyMatched)
  );
  const fallbackCount = Math.max(
    0,
    Math.min(
      1,
      Number.isFinite(Number(input.fallbackCount))
        ? Number(input.fallbackCount)
        : Number(command?.fallbackCount || 0)
    )
  );

  return {
    requestedExecutor,
    requestedMode: requestedExecutor,
    mode: normalizeCommandMode(
      Object.prototype.hasOwnProperty.call(input, "mode") ? input.mode : command?.mode
    ),
    actualExecutor: normalizedActualExecutor,
    actualDispatchMode: normalizedActualExecutor,
    cloudInputUnverified: normalizeBooleanValue(
      Object.prototype.hasOwnProperty.call(input, "cloudInputUnverified") ? input.cloudInputUnverified : command?.cloudInputUnverified
    ),
    slackDispatchAttempted: normalizeBooleanValue(input.slackDispatchAttempted, Boolean(command?.slackDispatchAttempted)),
    slackDispatchSucceeded: normalizeBooleanValue(input.slackDispatchSucceeded, Boolean(command?.slackDispatchSucceeded)),
    slackReplyReceived: normalizeBooleanValue(input.slackReplyReceived, Boolean(command?.slackReplyReceived)),
    slackReplyThreaded: normalizeBooleanValue(input.slackReplyThreaded, Boolean(command?.slackReplyThreaded)),
    replyMatched,
    slackReplyMatched: replyMatched,
    replyMatchedBy: normalizeReplyMatchedBy(
      Object.prototype.hasOwnProperty.call(input, "replyMatchedBy") ? input.replyMatchedBy : command?.replyMatchedBy
    ),
    fallbackCount,
    timeoutPhase: normalizeDiagnosticText(
      Object.prototype.hasOwnProperty.call(input, "timeoutPhase") ? input.timeoutPhase : command?.timeoutPhase,
      80
    ),
    fallbackApplied: normalizeBooleanValue(input.fallbackApplied, Boolean(command?.fallbackApplied)),
    fallbackReason: normalizeDiagnosticText(
      Object.prototype.hasOwnProperty.call(input, "fallbackReason") ? input.fallbackReason : command?.fallbackReason
    ),
    lastDiagnosticCode: normalizeDiagnosticText(
      Object.prototype.hasOwnProperty.call(input, "lastDiagnosticCode") ? input.lastDiagnosticCode : command?.lastDiagnosticCode,
      80
    ),
    lastDiagnosticDetail: normalizeDiagnosticText(
      Object.prototype.hasOwnProperty.call(input, "lastDiagnosticDetail") ? input.lastDiagnosticDetail : command?.lastDiagnosticDetail,
      500
    ),
    photoAttached: derivePhotoAttached(command, input),
    photoBytesPresent: derivePhotoBytesPresent(command, input),
    photoSeenByBridge: normalizeBooleanValue(input.photoSeenByBridge, Boolean(command?.photoSeenByBridge)),
    photoProcessed: normalizeBooleanValue(input.photoProcessed, Boolean(command?.photoProcessed)),
    photoUnsupportedReason: normalizePhotoUnsupportedReason(
      Object.prototype.hasOwnProperty.call(input, "photoUnsupportedReason")
        ? input.photoUnsupportedReason
        : command?.photoUnsupportedReason
    ),
    deliveryStopPoint: normalizeDiagnosticText(
      Object.prototype.hasOwnProperty.call(input, "deliveryStopPoint") ? input.deliveryStopPoint : command?.deliveryStopPoint,
      80
    ),
    deliveryEvidence: normalizeDeliveryEvidence(
      Object.prototype.hasOwnProperty.call(input, "deliveryEvidence") ? input.deliveryEvidence : command?.deliveryEvidence
    ),
    cloudJobId: normalizeCloudJobId(
      Object.prototype.hasOwnProperty.call(input, "cloudJobId") ? input.cloudJobId : command?.cloudJobId
    ),
    progressMessage: normalizeProgressMessage(
      Object.prototype.hasOwnProperty.call(input, "progressMessage") ? input.progressMessage : command?.progressMessage
    ),
    firstAckAt: normalizeDateValue(
      Object.prototype.hasOwnProperty.call(input, "firstAckAt") ? input.firstAckAt : command?.firstAckAt
    ),
    resultAt: normalizeDateValue(
      Object.prototype.hasOwnProperty.call(input, "resultAt") ? input.resultAt : command?.resultAt
    ),
    ...normalizeLatencyFields(input, command)
  };
}

function isOlderThan(value, maxAgeMs) {
  const timestamp = Date.parse(String(value || "").trim());

  if (Number.isNaN(timestamp)) {
    return false;
  }

  return Date.now() - timestamp > maxAgeMs;
}

function normalizePhoto(input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const dataUrl = String(input.dataUrl || "").trim();
  const contentType = String(input.contentType || "").trim().toLowerCase();
  const fileName = String(input.fileName || "").trim().slice(0, 120);
  const size = Number(input.size || 0);

  if (!dataUrl) {
    return null;
  }

  if (!contentType.startsWith("image/")) {
    return {
      ok: false,
      error: "Photo must be an image."
    };
  }

  if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) {
    return {
      ok: false,
      error: "Photo must be sent as a data URL."
    };
  }

  if (dataUrl.length > 6_000_000 || size > 4_500_000) {
    return {
      ok: false,
      error: "Photo is too large. Use an image up to 4.5 MB."
    };
  }

  return {
    ok: true,
    value: {
      fileName: fileName || "photo",
      contentType,
      size,
      dataUrl
    }
  };
}

function compactPhotoForStorage(photo, keepDataUrl = false) {
  if (!photo || typeof photo !== "object") {
    return null;
  }

  const compact = {
    fileName: String(photo.fileName || "").trim().slice(0, 120),
    contentType: String(photo.contentType || "").trim().toLowerCase(),
    size: Number(photo.size || 0)
  };

  if (keepDataUrl) {
    const dataUrl = String(photo.dataUrl || "").trim();

    if (dataUrl) {
      compact.dataUrl = dataUrl;
    }
  }

  return compact;
}

function compactCommandForStorage(command) {
  if (!command || typeof command !== "object") {
    return command;
  }

  const status = normalizeCommandStatus(command.status);
  const keepPhotoData = status === "queued" || status === "processing" || status === "dispatched";

  return {
    ...command,
    status,
    photo: compactPhotoForStorage(command.photo, keepPhotoData),
    routeAttempts: normalizeRouteAttempts(command.routeAttempts)
  };
}

function normalizeStoredCommandEntry(entry) {
  if (!entry || typeof entry !== "object" || typeof entry.text !== "string") {
    return null;
  }

  return {
    ...entry,
    status: normalizeCommandStatus(entry.status),
    fallbackThreadId: normalizeFallbackThreadId(entry.fallbackThreadId),
    fallbackThreadLabel: normalizeFallbackThreadLabel(entry.fallbackThreadLabel, entry.fallbackThreadId),
    dispatchMode: normalizeDispatchValue(entry.dispatchMode),
    projectId: normalizeThreadId(entry.projectId || entry.threadId),
    projectLabel: normalizeThreadLabel(entry.projectLabel || entry.threadLabel, entry.threadId),
    projectCategory: normalizeDiagnosticText(entry.projectCategory, 120),
    targetRepo: normalizeRepoValue(entry.targetRepo),
    targetRepoUrl: normalizeUrlValue(entry.targetRepoUrl),
    targetContextFiles: normalizeStringArray(entry.targetContextFiles),
    targetWorkspacePath: normalizeWorkspacePathValue(entry.targetWorkspacePath),
    targetExecutionMode: normalizeExecutionMode(entry.targetExecutionMode),
    requestedExecutor: normalizeExecutionMode(entry.requestedExecutor || entry.requestedMode || entry.targetExecutionMode),
    requestedMode: normalizeExecutionMode(entry.requestedExecutor || entry.requestedMode || entry.targetExecutionMode),
    mode: normalizeCommandMode(entry.mode),
    actualExecutor: normalizeActualExecutionMode(entry.actualExecutor || entry.actualDispatchMode),
    actualDispatchMode: normalizeActualExecutionMode(entry.actualExecutor || entry.actualDispatchMode),
    cloudInputUnverified: normalizeBooleanValue(entry.cloudInputUnverified),
    slackDispatchAttempted: normalizeBooleanValue(entry.slackDispatchAttempted),
    slackDispatchSucceeded: normalizeBooleanValue(entry.slackDispatchSucceeded),
    slackReplyReceived: normalizeBooleanValue(entry.slackReplyReceived),
    slackReplyThreaded: normalizeBooleanValue(entry.slackReplyThreaded),
    replyMatched: normalizeBooleanValue(entry.replyMatched, normalizeBooleanValue(entry.slackReplyMatched)),
    slackReplyMatched: normalizeBooleanValue(entry.replyMatched, normalizeBooleanValue(entry.slackReplyMatched)),
    replyMatchedBy: normalizeReplyMatchedBy(entry.replyMatchedBy),
    fallbackCount: Math.max(0, Math.min(1, Number(entry.fallbackCount || 0))),
    timeoutPhase: normalizeDiagnosticText(entry.timeoutPhase, 80),
    fallbackApplied: normalizeBooleanValue(entry.fallbackApplied),
    fallbackReason: normalizeDiagnosticText(entry.fallbackReason),
    lastDiagnosticCode: normalizeDiagnosticText(entry.lastDiagnosticCode, 80),
    lastDiagnosticDetail: normalizeDiagnosticText(entry.lastDiagnosticDetail, 500),
    photoAttached: derivePhotoAttached(entry),
    photoBytesPresent: derivePhotoBytesPresent(entry),
    photoSeenByBridge: normalizeBooleanValue(entry.photoSeenByBridge),
    photoProcessed: normalizeBooleanValue(entry.photoProcessed),
    photoUnsupportedReason: normalizePhotoUnsupportedReason(entry.photoUnsupportedReason),
    deliveryStopPoint: normalizeDiagnosticText(entry.deliveryStopPoint, 80),
    deliveryEvidence: normalizeDeliveryEvidence(entry.deliveryEvidence),
    cloudJobId: normalizeCloudJobId(entry.cloudJobId),
    progressMessage: normalizeProgressMessage(entry.progressMessage),
    routeAttempts: normalizeRouteAttempts(entry.routeAttempts),
    firstAckAt: normalizeDateValue(entry.firstAckAt),
    resultAt: normalizeDateValue(entry.resultAt || entry.completedAt),
    slackChannelId: normalizeSlackValue(entry.slackChannelId),
    slackMessageTs: normalizeSlackValue(entry.slackMessageTs),
    slackThreadTs: normalizeSlackValue(entry.slackThreadTs),
    prUrl: String(entry.prUrl || "").trim(),
    branchName: normalizeSlackValue(entry.branchName),
    errorMessage: normalizeErrorMessage(entry.errorMessage),
    dispatchedAt: normalizeDateValue(entry.dispatchedAt),
    completedAt: normalizeDateValue(entry.completedAt),
    ...normalizeLatencyFields(entry)
  };
}

function isWithinRetentionWindow(value) {
  const timestamp = Date.parse(String(value || "").trim());

  if (Number.isNaN(timestamp)) {
    return false;
  }

  return timestamp >= Date.now() - HISTORY_RETENTION_MS;
}

function isRecentEnough(value, windowMs) {
  const timestamp = Date.parse(String(value || "").trim());

  if (Number.isNaN(timestamp)) {
    return false;
  }

  return timestamp >= Date.now() - windowMs;
}

function isParallelVisionCommand(command) {
  if (!command?.photo) {
    return false;
  }

  const text = canonicalizeText(command?.text);

  if (!text) {
    return true;
  }

  const mutationHints = [
    "исправ",
    "fix",
    "сделай",
    "сделать",
    "перенеси",
    "добавь",
    "update",
    "deploy",
    "commit",
    "pr",
    "код",
    "code",
    "repo",
    "branch"
  ];

  if (mutationHints.some((hint) => text.includes(hint))) {
    return false;
  }

  const visionHints = [
    "что на фото",
    "прочти фото",
    "кнопка",
    "what color",
    "read the image",
    "what is in the image",
    "reset",
    "photo",
    "screenshot"
  ];

  return visionHints.some((hint) => text.includes(hint));
}

function getCommandThreadKey(command) {
  if (isParallelVisionCommand(command)) {
    return "::";
  }

  const threadId = normalizeThreadId(command?.threadId);
  const clientId = normalizeClientId(command?.clientId);
  return `${threadId}::${clientId}`;
}

function getCommandIntentKey(command) {
  const threadKey = getCommandThreadKey(command);
  const textKey = canonicalizeText(command?.text);

  if (threadKey === "::" || !textKey) {
    return "";
  }

  return `${threadKey}::${textKey}`;
}

function isSameCommandIntent(left, right) {
  const leftKey = getCommandIntentKey(left);
  const rightKey = getCommandIntentKey(right);

  if (!leftKey || !rightKey) {
    return false;
  }

  return leftKey === rightKey;
}

function findRecentDuplicate(commands, candidate) {
  return commands.find((command) => {
    if (!command || typeof command !== "object") {
      return false;
    }

    // Deduplicate only while an identical command is still in flight.
    // Once a dialog message has already been answered/acked, the user must be
    // able to send the same text again and get a new saved entry in history.
    if (!isActiveCommandStatus(command.status)) {
      return false;
    }

    if (!isRecentEnough(command.createdAt, RECENT_DUPLICATE_WINDOW_MS)) {
      return false;
    }

    return isSameCommandIntent(command, candidate);
  }) || null;
}

function markCommandAcked(command, nowIso) {
  return {
    ...command,
    status: "acked",
    ackedAt: nowIso,
    resultAt: command.resultAt || nowIso,
    progressStage: "acked",
    progressUpdatedAt: nowIso,
    processingStartedAt: "",
    processingLeaseUntil: "",
    processorId: ""
  };
}

export function createCommandRecord(input) {
  const text = normalizeText(input.text);
  const clientId = normalizeClientId(input.clientId);
  const threadId = normalizeThreadId(input.threadId);
  const threadLabel = normalizeThreadLabel(input.threadLabel, threadId);
  const fallbackThreadId = normalizeFallbackThreadId(input.fallbackThreadId);
  const fallbackThreadLabel = normalizeFallbackThreadLabel(input.fallbackThreadLabel, fallbackThreadId);
  const normalizedPhoto = normalizePhoto(input.photo);

  if (normalizedPhoto && !normalizedPhoto.ok) {
    return normalizedPhoto;
  }

  if (!text && !normalizedPhoto?.value) {
    return {
      ok: false,
      error: "Command text or photo is required."
    };
  }

  if (!clientId) {
    return {
      ok: false,
      error: "clientId is required."
    };
  }

  if (!threadId) {
    return {
      ok: false,
      error: "threadId is required."
    };
  }

  return {
    ok: true,
    value: {
      id: crypto.randomUUID(),
      text,
      clientId,
      threadId,
      threadLabel,
      fallbackThreadId,
      fallbackThreadLabel,
      photo: normalizedPhoto?.value || null,
      createdAt: new Date().toISOString(),
      status: "queued",
      progressStage: "queued",
      progressUpdatedAt: new Date().toISOString(),
      source: "site",
      dispatchMode: normalizeDispatchValue(input.dispatchMode),
      projectId: normalizeThreadId(input.projectId || input.threadId),
      projectLabel: normalizeThreadLabel(input.projectLabel || input.threadLabel, input.threadId),
      projectCategory: normalizeDiagnosticText(input.projectCategory, 120),
      targetRepo: normalizeRepoValue(input.targetRepo),
      targetRepoUrl: normalizeUrlValue(input.targetRepoUrl),
      targetContextFiles: normalizeStringArray(input.targetContextFiles),
      targetWorkspacePath: normalizeWorkspacePathValue(input.targetWorkspacePath),
      targetExecutionMode: normalizeExecutionMode(input.targetExecutionMode),
      requestedExecutor: normalizeExecutionMode(input.targetExecutionMode || input.dispatchMode),
      requestedMode: normalizeExecutionMode(input.targetExecutionMode || input.dispatchMode),
      mode: normalizeCommandMode(input.mode),
      actualExecutor: "",
      actualDispatchMode: "",
      cloudInputUnverified: false,
      slackDispatchAttempted: false,
      slackDispatchSucceeded: false,
      slackReplyReceived: false,
      slackReplyThreaded: false,
      replyMatched: false,
      slackReplyMatched: false,
      replyMatchedBy: "",
      fallbackCount: 0,
      timeoutPhase: "",
      fallbackApplied: false,
      fallbackReason: "",
      lastDiagnosticCode: "",
      lastDiagnosticDetail: "",
      photoAttached: Boolean(normalizedPhoto?.value),
      photoBytesPresent: Boolean(String(normalizedPhoto?.value?.dataUrl || "").trim()),
      photoSeenByBridge: false,
      photoProcessed: false,
      photoUnsupportedReason: "",
      deliveryStopPoint: "",
      deliveryEvidence: null,
      cloudJobId: "",
      progressMessage: "",
      routeAttempts: [],
      firstAckAt: "",
      resultAt: "",
      slackChannelId: "",
      slackMessageTs: "",
      slackThreadTs: "",
      prUrl: "",
      branchName: "",
      errorMessage: "",
      dispatchedAt: "",
      completedAt: "",
      ...normalizeLatencyFields({
        uiSubmitStartedAt: input.uiSubmitStartedAt,
        apiCommandsRequestStartedAt: input.apiCommandsRequestStartedAt,
        commandCreatedAt: input.commandCreatedAt
      })
    }
  };
}

export async function readCommands(env) {
  let existing = [];
  const indexedIds = await readIdIndex(env, COMMANDS_RECENT_STORAGE_KEY).catch(() => []);

  if (indexedIds.length) {
    existing = await readStoredCommandsByIds(env, indexedIds);
  } else {
    const legacy = await env.LINKS_STORE.get(COMMANDS_STORAGE_KEY, "json");
    existing = Array.isArray(legacy) ? legacy : [];
  }

  return existing
    .map((entry) => normalizeStoredCommandEntry(entry))
    .filter((entry) => isWithinRetentionWindow(entry.createdAt))
    .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
}

export async function writeCommands(env, commands) {
  const trimmed = commands
    .map((command) => compactCommandForStorage(command))
    .filter((command) => isWithinRetentionWindow(command?.createdAt))
    .slice(-MAX_COMMANDS);
  await rebuildCommandIndexes(env, trimmed);
  return trimmed;
}

export async function insertCommand(env, input) {
  const normalized = createCommandRecord(input);

  if (!normalized.ok) {
    return normalized;
  }

  if (normalized.value.dispatchMode === DISPATCH_MODE_SLACK && !normalized.value.targetRepo) {
    return {
      ok: false,
      error: "Cloud dispatch requires a target repository."
    };
  }

  const current = await getCommandsForClient(env, normalized.value.clientId);
  const duplicate = findRecentDuplicate(current, normalized.value);

  if (duplicate) {
    return {
      ok: true,
      value: duplicate
    };
  }

  await persistCommand(env, normalized.value);

  return normalized;
}

export async function acknowledgeCommands(env, ids) {
  const idSet = new Set(
    (Array.isArray(ids) ? ids : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );

  if (!idSet.size) {
    return {
      ok: false,
      error: "At least one command id is required."
    };
  }

  const current = await readCommands(env);
  const next = current.map((command) => {
    if (!idSet.has(command.id)) {
      return command;
    }

    return {
      ...command,
      status: "acked",
      ackedAt: new Date().toISOString(),
      progressStage: "acked",
      progressUpdatedAt: new Date().toISOString(),
      processingStartedAt: "",
      processingLeaseUntil: "",
      processorId: ""
    };
  });

  await writeCommands(env, next);

  return {
    ok: true,
    value: next.filter((command) => idSet.has(command.id))
  };
}

export async function claimNextCommand(env, input = {}) {
  const processorId = String(input.processorId || "").trim().slice(0, 120) || "bridge";
  const leaseMs = Math.max(5_000, Number(input.leaseMs) || COMMAND_PROCESSING_LEASE_MS);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const leaseUntil = new Date(now + leaseMs).toISOString();

  const [queuedIds, processingIds] = await Promise.all([
    readIdIndex(env, COMMAND_LOCAL_QUEUE_STORAGE_KEY).catch(() => []),
    readIdIndex(env, COMMAND_LOCAL_PROCESSING_STORAGE_KEY).catch(() => [])
  ]);
  const processingCommands = await readStoredCommandsByIds(env, processingIds);
  const activeThreadKeys = new Set();

  for (const command of processingCommands) {
    if (!command || command.dispatchMode !== DISPATCH_MODE_LOCAL || command.status !== "processing") {
      continue;
    }

    const leaseDeadline = Date.parse(String(command.processingLeaseUntil || "").trim());

    if (!Number.isNaN(leaseDeadline) && leaseDeadline <= now) {
      await persistCommand(env, {
        ...command,
        status: "queued",
        progressStage: "queued",
        progressUpdatedAt: nowIso,
        processingStartedAt: "",
        processingLeaseUntil: "",
        processorId: ""
      });
      continue;
    }

    const threadKey = getCommandThreadKey(command);
    if (threadKey !== "::") {
      activeThreadKeys.add(threadKey);
    }
  }

  const queuedCommands = await readStoredCommandsByIds(env, queuedIds);
  const candidate = queuedCommands.find((command) => {
    if (!command || command.dispatchMode !== DISPATCH_MODE_LOCAL || command.status !== "queued") {
      return false;
    }

    const threadKey = getCommandThreadKey(command);
    return threadKey === "::" || !activeThreadKeys.has(threadKey);
  });

  if (!candidate) {
    return {
      ok: true,
      value: null
    };
  }

  const claimed = {
    ...candidate,
    status: "processing",
    progressStage: "accepted",
    progressUpdatedAt: nowIso,
    firstAckAt: candidate.firstAckAt || nowIso,
    actualExecutor: "bridge",
    actualDispatchMode: "bridge",
    dispatchStartedAt: candidate.dispatchStartedAt || nowIso,
    bridgeClaimedAt: candidate.bridgeClaimedAt || nowIso,
    firstExecutorAckSeenAt: candidate.firstExecutorAckSeenAt || nowIso,
    photoSeenByBridge: Boolean(candidate.photo),
    processingStartedAt: nowIso,
    processingLeaseUntil: leaseUntil,
    processorId
  };
  await persistCommand(env, claimed);

  return {
    ok: true,
    value: claimed
  };
}

export async function requeueCommand(env, id) {
  const normalizedId = String(id || "").trim();

  if (!normalizedId) {
    return {
      ok: false,
      error: "Command id is required."
    };
  }

  const nowIso = new Date().toISOString();
  const current = await readCommands(env);
  let updated = null;

  const next = current.map((command) => {
    if (command.id !== normalizedId) {
      return command;
    }

    updated = {
      ...command,
      status: "queued",
      progressStage: "queued",
      progressUpdatedAt: nowIso,
      processingStartedAt: "",
      processingLeaseUntil: "",
      processorId: ""
    };

    return updated;
  });

  if (!updated) {
    return {
      ok: false,
      error: "Command not found."
    };
  }

  await writeCommands(env, next);

  return {
    ok: true,
    value: updated
  };
}

export async function fallbackCommandToLocalBridge(env, input = {}) {
  return updateCommand(env, input.id, (command, nowIso) => ({
    ...command,
    ...mergeCommandDebugState(command, {
      actualExecutor: "bridge",
      mode: input.mode,
      cloudInputUnverified: input.cloudInputUnverified,
      fallbackApplied: true,
      fallbackCount: Math.min(1, Number(command?.fallbackCount || 0) + 1),
      fallbackReason: input.fallbackReason || command.fallbackReason,
      timeoutPhase: Object.prototype.hasOwnProperty.call(input, "timeoutPhase") ? input.timeoutPhase : command.timeoutPhase,
      lastDiagnosticCode: input.lastDiagnosticCode || command.lastDiagnosticCode,
      lastDiagnosticDetail: input.lastDiagnosticDetail || command.lastDiagnosticDetail,
      deliveryStopPoint: input.deliveryStopPoint,
      deliveryEvidence: input.deliveryEvidence
    }, DISPATCH_MODE_LOCAL),
    dispatchMode: DISPATCH_MODE_LOCAL,
    status: "queued",
    progressStage: normalizeProgressStage(input.progressStage) || "queued",
    progressUpdatedAt: nowIso,
    slackChannelId: "",
    slackMessageTs: "",
    slackThreadTs: "",
    errorMessage: normalizeErrorMessage(input.errorMessage),
    dispatchedAt: "",
    firstAckAt: "",
    resultAt: "",
    processingStartedAt: "",
    processingLeaseUntil: "",
    processorId: "",
    completedAt: "",
    dispatchStartedAt: "",
    slackPostedAt: "",
    bridgeClaimedAt: "",
    firstExecutorAckSeenAt: "",
    firstReplySeenAt: "",
    replyIngestedAt: "",
    routeAttempts: appendRouteAttempt(command, {
      at: nowIso,
      mode: DISPATCH_MODE_LOCAL,
      stage: normalizeProgressStage(input.progressStage) || "fallback-to-bridge",
      slackChannelId: command.slackChannelId,
      slackThreadTs: command.slackThreadTs,
      slackMessageTs: command.slackMessageTs,
      fallbackReason: input.fallbackReason || command.fallbackReason,
      diagnosticCode: input.lastDiagnosticCode || command.lastDiagnosticCode,
      diagnosticDetail: input.lastDiagnosticDetail || command.lastDiagnosticDetail
    }, nowIso)
  }));
}

export async function rerouteCommandToLocalBridge(env, input = {}) {
  return updateCommand(env, input.id, (command, nowIso) => ({
    ...command,
    ...mergeCommandDebugState(command, {
      actualExecutor: "bridge",
      mode: input.mode,
      cloudInputUnverified: input.cloudInputUnverified,
      fallbackApplied: true,
      fallbackCount: Math.min(1, Number(command?.fallbackCount || 0) + 1),
      fallbackReason: input.fallbackReason || command.fallbackReason,
      timeoutPhase: Object.prototype.hasOwnProperty.call(input, "timeoutPhase") ? input.timeoutPhase : command.timeoutPhase,
      lastDiagnosticCode: input.lastDiagnosticCode || command.lastDiagnosticCode,
      lastDiagnosticDetail: input.lastDiagnosticDetail || command.lastDiagnosticDetail,
      deliveryStopPoint: input.deliveryStopPoint,
      deliveryEvidence: input.deliveryEvidence
    }, DISPATCH_MODE_LOCAL),
    dispatchMode: DISPATCH_MODE_LOCAL,
    status: "queued",
    progressStage: normalizeProgressStage(input.progressStage) || "queued",
    progressUpdatedAt: nowIso,
    errorMessage: normalizeErrorMessage(input.errorMessage),
    slackChannelId: "",
    slackMessageTs: "",
    slackThreadTs: "",
    dispatchedAt: "",
    firstAckAt: "",
    resultAt: "",
    processingStartedAt: "",
    processingLeaseUntil: "",
    processorId: "",
    completedAt: "",
    dispatchStartedAt: "",
    slackPostedAt: "",
    bridgeClaimedAt: "",
    firstExecutorAckSeenAt: "",
    firstReplySeenAt: "",
    replyIngestedAt: "",
    routeAttempts: appendRouteAttempt(command, {
      at: nowIso,
      mode: DISPATCH_MODE_LOCAL,
      stage: normalizeProgressStage(input.progressStage) || "switched-to-bridge",
      slackChannelId: command.slackChannelId,
      slackThreadTs: command.slackThreadTs,
      slackMessageTs: command.slackMessageTs,
      fallbackReason: input.fallbackReason || command.fallbackReason,
      diagnosticCode: input.lastDiagnosticCode || command.lastDiagnosticCode,
      diagnosticDetail: input.lastDiagnosticDetail || command.lastDiagnosticDetail
    }, nowIso)
  }));
}

export async function rerouteCommandToSlack(env, input = {}) {
  return updateCommand(env, input.id, (command, nowIso) => ({
    ...command,
    ...mergeCommandDebugState(command, {
      actualExecutor: "cloud",
      timeoutPhase: "",
      fallbackApplied: true,
      fallbackCount: Math.min(1, Number(command?.fallbackCount || 0) + 1),
      fallbackReason: input.fallbackReason || command.fallbackReason,
      lastDiagnosticCode: input.lastDiagnosticCode || command.lastDiagnosticCode,
      lastDiagnosticDetail: input.lastDiagnosticDetail || command.lastDiagnosticDetail
    }, DISPATCH_MODE_SLACK),
    dispatchMode: DISPATCH_MODE_SLACK,
    status: "queued",
    progressStage: normalizeProgressStage(input.progressStage) || "queued",
    progressUpdatedAt: nowIso,
    errorMessage: normalizeErrorMessage(input.errorMessage),
    slackChannelId: "",
    slackMessageTs: "",
    slackThreadTs: "",
    dispatchedAt: "",
    firstAckAt: "",
    resultAt: "",
    processingStartedAt: "",
    processingLeaseUntil: "",
    processorId: "",
    completedAt: "",
    dispatchStartedAt: "",
    slackPostedAt: "",
    bridgeClaimedAt: "",
    firstExecutorAckSeenAt: "",
    firstReplySeenAt: "",
    replyIngestedAt: "",
    routeAttempts: appendRouteAttempt(command, {
      at: nowIso,
      mode: DISPATCH_MODE_SLACK,
      stage: normalizeProgressStage(input.progressStage) || "switched-to-cloud",
      slackChannelId: command.slackChannelId,
      slackThreadTs: command.slackThreadTs,
      slackMessageTs: command.slackMessageTs,
      fallbackReason: input.fallbackReason || command.fallbackReason,
      diagnosticCode: input.lastDiagnosticCode || command.lastDiagnosticCode,
      diagnosticDetail: input.lastDiagnosticDetail || command.lastDiagnosticDetail
    }, nowIso)
  }));
}

export async function updateCommandProgress(env, input = {}) {
  const id = String(input.id || "").trim();
  const progressStage = normalizeProgressStage(input.progressStage);
  const processingLeaseUntil = String(input.processingLeaseUntil || "").trim();

  if (!id) {
    return {
      ok: false,
      error: "Command id is required."
    };
  }

  if (!progressStage) {
    return {
      ok: false,
      error: "Progress stage is required."
    };
  }

  const nowIso = new Date().toISOString();
  const current = await readCommands(env);
  let updated = null;

  const next = current.map((command) => {
    if (command.id !== id) {
      return command;
    }

    updated = {
      ...command,
      ...mergeCommandDebugState(command, input, command.dispatchMode),
      progressStage,
      progressUpdatedAt: normalizeProgressUpdatedAt(input.progressUpdatedAt) || nowIso
    };

    if (command.status === "processing" && processingLeaseUntil) {
      updated.processingLeaseUntil = processingLeaseUntil;
    }

    return updated;
  });

  if (!updated) {
    return {
      ok: false,
      error: "Command not found."
    };
  }

  await writeCommands(env, next);

  return {
    ok: true,
    value: updated
  };
}

async function updateCommand(env, id, updater) {
  const normalizedId = String(id || "").trim();

  if (!normalizedId) {
    return {
      ok: false,
      error: "Command id is required."
    };
  }

  const current = await getCommandById(env, normalizedId);

  if (!current) {
    return {
      ok: false,
      error: "Command not found."
    };
  }

  const nowIso = new Date().toISOString();
  const updated = updater(current, nowIso) || current;
  await persistCommand(env, updated);
  return {
    ok: true,
    value: updated
  };
}

export async function markCommandDispatched(env, input = {}) {
  const dispatchMode = normalizeDispatchValue(input.dispatchMode);
  return updateCommand(env, input.id, (command, nowIso) => ({
    ...command,
    ...mergeCommandDebugState(command, {
      actualExecutor: "",
      mode: input.mode,
      cloudInputUnverified: input.cloudInputUnverified,
      slackDispatchAttempted: true,
      slackDispatchSucceeded: dispatchMode === DISPATCH_MODE_SLACK,
      timeoutPhase: "",
      resultAt: "",
      deliveryStopPoint: input.deliveryStopPoint,
      deliveryEvidence: input.deliveryEvidence,
      dispatchStartedAt: normalizeDateValue(input.dispatchStartedAt) || command.dispatchStartedAt || nowIso,
      slackPostedAt: dispatchMode === DISPATCH_MODE_SLACK
        ? (normalizeDateValue(input.slackPostedAt) || nowIso)
        : command.slackPostedAt
    }, dispatchMode),
    dispatchMode,
    status: dispatchMode === DISPATCH_MODE_SLACK ? "dispatched" : "processing",
    progressStage: normalizeProgressStage(input.progressStage) || (dispatchMode === DISPATCH_MODE_SLACK ? "dispatched" : "dispatching"),
    progressUpdatedAt: nowIso,
    slackChannelId: normalizeSlackValue(input.slackChannelId),
    slackMessageTs: normalizeSlackValue(input.slackMessageTs),
    slackThreadTs: normalizeSlackValue(input.slackThreadTs || input.slackMessageTs),
    dispatchedAt: normalizeDateValue(input.dispatchedAt) || nowIso,
    errorMessage: "",
    processorId: "",
    processingStartedAt: "",
    processingLeaseUntil: "",
    completedAt: "",
    routeAttempts: appendRouteAttempt(command, {
      at: nowIso,
      mode: dispatchMode,
      stage: normalizeProgressStage(input.progressStage) || (dispatchMode === DISPATCH_MODE_SLACK ? "dispatched" : "dispatching"),
      slackChannelId: input.slackChannelId,
      slackThreadTs: input.slackThreadTs || input.slackMessageTs,
      slackMessageTs: input.slackMessageTs,
      diagnosticCode: input.lastDiagnosticCode,
      diagnosticDetail: input.lastDiagnosticDetail,
      photoFileId: input.photoFileId,
      photoPermalink: input.photoPermalink
    }, nowIso)
  }));
}

export async function markCommandAnswered(env, input = {}) {
  return updateCommand(env, input.id, (command, nowIso) => ({
    ...command,
    ...mergeCommandDebugState(command, {
      actualExecutor: input.actualExecutor || input.actualDispatchMode || command.actualExecutor || command.actualDispatchMode,
      slackReplyReceived: typeof input.slackReplyReceived === "boolean" ? input.slackReplyReceived : command.slackReplyReceived,
      slackReplyThreaded: typeof input.slackReplyThreaded === "boolean" ? input.slackReplyThreaded : command.slackReplyThreaded,
      replyMatched: typeof input.replyMatched === "boolean"
        ? input.replyMatched
        : (typeof input.slackReplyMatched === "boolean" ? input.slackReplyMatched : command.replyMatched),
      replyMatchedBy: input.replyMatchedBy || command.replyMatchedBy,
      firstAckAt: normalizeDateValue(input.firstAckAt) || command.firstAckAt || nowIso,
      resultAt: normalizeDateValue(input.resultAt) || nowIso,
      photoProcessed: typeof input.photoProcessed === "boolean" ? input.photoProcessed : Boolean(command.photoAttached || command.photoSeenByBridge),
      timeoutPhase: "",
      lastDiagnosticCode: input.lastDiagnosticCode || command.lastDiagnosticCode,
      lastDiagnosticDetail: input.lastDiagnosticDetail || command.lastDiagnosticDetail,
      firstExecutorAckSeenAt: normalizeDateValue(input.firstExecutorAckSeenAt) || command.firstExecutorAckSeenAt || normalizeDateValue(input.firstAckAt) || nowIso,
      firstReplySeenAt: normalizeDateValue(input.firstReplySeenAt) || command.firstReplySeenAt || nowIso,
      replyIngestedAt: normalizeDateValue(input.replyIngestedAt) || command.replyIngestedAt || nowIso
    }, input.dispatchMode || command.dispatchMode),
    status: "answered",
    progressStage: normalizeProgressStage(input.progressStage) || "answered",
    progressUpdatedAt: nowIso,
    prUrl: String(input.prUrl || command.prUrl || "").trim(),
    branchName: normalizeSlackValue(input.branchName || command.branchName),
    resultAt: normalizeDateValue(input.resultAt) || nowIso,
    completedAt: normalizeDateValue(input.completedAt) || nowIso,
    errorMessage: ""
  }));
}

export async function markCommandFailed(env, input = {}) {
  return updateCommand(env, input.id, (command, nowIso) => ({
    ...command,
    ...mergeCommandDebugState(command, {
      actualExecutor: input.actualExecutor || input.actualDispatchMode || command.actualExecutor || command.actualDispatchMode,
      firstAckAt: normalizeDateValue(input.firstAckAt) || command.firstAckAt,
      resultAt: normalizeDateValue(input.resultAt) || nowIso,
      timeoutPhase: Object.prototype.hasOwnProperty.call(input, "timeoutPhase") ? input.timeoutPhase : command.timeoutPhase,
      fallbackApplied: typeof input.fallbackApplied === "boolean" ? input.fallbackApplied : command.fallbackApplied,
      fallbackCount: Object.prototype.hasOwnProperty.call(input, "fallbackCount") ? input.fallbackCount : command.fallbackCount,
      fallbackReason: input.fallbackReason || command.fallbackReason,
      lastDiagnosticCode: input.lastDiagnosticCode || command.lastDiagnosticCode,
      lastDiagnosticDetail: input.lastDiagnosticDetail || command.lastDiagnosticDetail,
      photoProcessed: typeof input.photoProcessed === "boolean" ? input.photoProcessed : Boolean(command.photoSeenByBridge),
      firstExecutorAckSeenAt: normalizeDateValue(input.firstExecutorAckSeenAt) || command.firstExecutorAckSeenAt,
      firstReplySeenAt: normalizeDateValue(input.firstReplySeenAt) || command.firstReplySeenAt,
      replyIngestedAt: normalizeDateValue(input.replyIngestedAt) || command.replyIngestedAt
    }, input.dispatchMode || command.dispatchMode),
    status: "failed",
    progressStage: normalizeProgressStage(input.progressStage) || "failed",
    progressUpdatedAt: nowIso,
    errorMessage: normalizeErrorMessage(input.errorMessage),
    resultAt: normalizeDateValue(input.resultAt) || nowIso,
    completedAt: normalizeDateValue(input.completedAt) || nowIso
  }));
}

export async function upsertCommandDispatchState(env, input = {}) {
  const nextStatus = normalizeCommandStatus(input.status);

  return updateCommand(env, input.id, (command, nowIso) => ({
    ...command,
    ...mergeCommandDebugState(command, input, input.dispatchMode || command.dispatchMode),
    dispatchMode: normalizeDispatchValue(input.dispatchMode || command.dispatchMode),
    status: nextStatus,
    progressStage: normalizeProgressStage(input.progressStage) || nextStatus,
    progressUpdatedAt: nowIso,
    slackChannelId: normalizeSlackValue(input.slackChannelId || command.slackChannelId),
    slackMessageTs: normalizeSlackValue(input.slackMessageTs || command.slackMessageTs),
    slackThreadTs: normalizeSlackValue(input.slackThreadTs || command.slackThreadTs || command.slackMessageTs),
    prUrl: String(input.prUrl || command.prUrl || "").trim(),
    branchName: normalizeSlackValue(input.branchName || command.branchName),
    errorMessage: normalizeErrorMessage(input.errorMessage || (nextStatus === "failed" ? command.errorMessage : "")),
    dispatchedAt: normalizeDateValue(input.dispatchedAt || command.dispatchedAt),
    firstAckAt: nextStatus === "processing" || nextStatus === "answered" || nextStatus === "failed"
      ? (normalizeDateValue(input.firstAckAt) || command.firstAckAt || nowIso)
      : command.firstAckAt,
    resultAt: nextStatus === "answered" || nextStatus === "failed"
      ? (normalizeDateValue(input.resultAt) || command.resultAt || nowIso)
      : command.resultAt,
    processingStartedAt: nextStatus === "processing"
      ? (normalizeDateValue(input.processingStartedAt) || command.processingStartedAt || nowIso)
      : command.processingStartedAt,
    completedAt: nextStatus === "answered" || nextStatus === "failed"
      ? (normalizeDateValue(input.completedAt) || command.completedAt || nowIso)
      : command.completedAt,
    dispatchStartedAt: normalizeDateValue(input.dispatchStartedAt || command.dispatchStartedAt),
    slackPostedAt: normalizeDateValue(input.slackPostedAt || command.slackPostedAt),
    bridgeClaimedAt: normalizeDateValue(input.bridgeClaimedAt || command.bridgeClaimedAt),
    firstExecutorAckSeenAt: normalizeDateValue(
      input.firstExecutorAckSeenAt
      || command.firstExecutorAckSeenAt
      || (nextStatus === "processing" || nextStatus === "answered" || nextStatus === "failed"
        ? (normalizeDateValue(input.firstAckAt) || command.firstAckAt)
        : "")
    ),
    firstReplySeenAt: normalizeDateValue(input.firstReplySeenAt || command.firstReplySeenAt),
    replyIngestedAt: normalizeDateValue(input.replyIngestedAt || command.replyIngestedAt),
    uiVisibleAt: normalizeDateValue(input.uiVisibleAt || command.uiVisibleAt)
  }));
}

export async function getCommandBySlackThread(env, channelId, threadTs) {
  const normalizedChannelId = normalizeSlackValue(channelId);
  const normalizedThreadTs = normalizeSlackValue(threadTs);

  if (!normalizedChannelId || !normalizedThreadTs) {
    return null;
  }

  const commands = await readCommands(env);
  return commands.find((command) =>
    command.slackChannelId === normalizedChannelId
      && (command.slackThreadTs === normalizedThreadTs || command.slackMessageTs === normalizedThreadTs)
  ) || null;
}

function canFallbackToLocal(command, options = {}) {
  return Boolean(options.fallbackToLocal) && Number(command?.fallbackCount || 0) < 1 && (
    (String(command?.threadId || "").trim() && !String(command?.threadId || "").trim().startsWith("cloud:"))
    || String(command?.fallbackThreadId || "").trim()
  );
}

function canFallbackToSlack(command, options = {}) {
  return Boolean(options.preferCloud || options.preferSlack)
    && Number(command?.fallbackCount || 0) < 1
    && Boolean(String(command?.targetRepo || "").trim());
}

function createFallbackState(command, nextDispatchMode, nowIso, input = {}) {
  const nextExecutor = dispatchModeToExecutionMode(nextDispatchMode);

  return {
    ...command,
    ...mergeCommandDebugState(command, {
      actualExecutor: nextExecutor,
      fallbackApplied: true,
      fallbackCount: Math.min(1, Number(command?.fallbackCount || 0) + 1),
      fallbackReason: input.fallbackReason || command.fallbackReason,
      timeoutPhase: input.timeoutPhase || command.timeoutPhase,
      lastDiagnosticCode: input.lastDiagnosticCode || command.lastDiagnosticCode,
      lastDiagnosticDetail: input.lastDiagnosticDetail || command.lastDiagnosticDetail,
      firstAckAt: "",
      resultAt: "",
      dispatchStartedAt: "",
      slackPostedAt: "",
      bridgeClaimedAt: "",
      firstExecutorAckSeenAt: "",
      firstReplySeenAt: "",
      replyIngestedAt: ""
    }, nextDispatchMode),
    dispatchMode: nextDispatchMode,
    status: "queued",
    progressStage: input.progressStage || (nextDispatchMode === DISPATCH_MODE_CLOUD ? "switched-to-cloud" : "switched-to-bridge"),
    progressUpdatedAt: nowIso,
    errorMessage: normalizeErrorMessage(input.errorMessage),
    slackChannelId: "",
    slackMessageTs: "",
    slackThreadTs: "",
    dispatchedAt: "",
    firstAckAt: "",
    resultAt: "",
    processingStartedAt: "",
    processingLeaseUntil: "",
    processorId: "",
    completedAt: "",
    dispatchStartedAt: "",
    slackPostedAt: "",
    bridgeClaimedAt: "",
    firstExecutorAckSeenAt: "",
    firstReplySeenAt: "",
    replyIngestedAt: "",
    routeAttempts: appendRouteAttempt(command, {
      at: nowIso,
      mode: nextDispatchMode,
      stage: input.progressStage || (nextDispatchMode === DISPATCH_MODE_CLOUD ? "switched-to-cloud" : "switched-to-bridge"),
      slackChannelId: command.slackChannelId,
      slackThreadTs: command.slackThreadTs,
      slackMessageTs: command.slackMessageTs,
      fallbackReason: input.fallbackReason || command.fallbackReason,
      diagnosticCode: input.lastDiagnosticCode || command.lastDiagnosticCode,
      diagnosticDetail: input.lastDiagnosticDetail || command.lastDiagnosticDetail
    }, nowIso)
  };
}

function createFailedMaintenanceState(command, nowIso, input = {}) {
  return {
    ...command,
    ...mergeCommandDebugState(command, {
      actualExecutor: input.actualExecutor || command.actualExecutor || dispatchModeToExecutionMode(command.dispatchMode),
      timeoutPhase: input.timeoutPhase || command.timeoutPhase,
      lastDiagnosticCode: input.lastDiagnosticCode || command.lastDiagnosticCode,
      lastDiagnosticDetail: input.lastDiagnosticDetail || command.lastDiagnosticDetail,
      resultAt: nowIso
    }, command.dispatchMode),
    status: "failed",
    progressStage: input.progressStage || "failed",
    progressUpdatedAt: nowIso,
    errorMessage: normalizeErrorMessage(input.errorMessage),
    resultAt: nowIso,
    completedAt: nowIso
  };
}

function evaluateCloudMaintenance(command, nowIso, options = {}) {
  if (command.dispatchMode !== DISPATCH_MODE_CLOUD) {
    return command;
  }

  const fallbackAllowed = canFallbackToLocal(command, options);

  if (command.status !== "processing" && command.status !== "dispatched") {
    return command;
  }

  if (!String(command.cloudJobId || "").trim() && !String(command.firstAckAt || "").trim()) {
    const unackedSince = command.progressUpdatedAt || command.dispatchedAt || command.createdAt;

    if (!isOlderThan(unackedSince, CLOUD_FIRST_ACK_TIMEOUT_MS)) {
      return command;
    }

    return createFailedMaintenanceState(command, nowIso, {
      timeoutPhase: "claim-timeout",
      lastDiagnosticCode: "cloud_bridge_dispatch_unacked",
      lastDiagnosticDetail: "Trusted cloud bridge did not acknowledge the job before the cloud first-ack timeout.",
      actualExecutor: "cloud",
      errorMessage: stringifyCommandError({
        code: "cloud_bridge_dispatch_unacked",
        stage: "cloud-ack-timeout",
        message: "Trusted cloud bridge did not acknowledge the job in time.",
        detail: "The command never received a trusted cloud bridge job id or first executor acknowledgement."
      })
    });
  }

  const staleSince = command.progressUpdatedAt || command.dispatchedAt || command.createdAt;

  if (!isOlderThan(staleSince, CLOUD_RESULT_TIMEOUT_MS)) {
    return command;
  }
  const detail = "Direct cloud execution did not finish before the command timeout.";

  if (fallbackAllowed) {
    return createFallbackState(command, DISPATCH_MODE_LOCAL, nowIso, {
      progressStage: "switched-to-bridge",
      timeoutPhase: "result-timeout",
      fallbackReason: "direct cloud execution timed out",
      lastDiagnosticCode: "cloud_result_timeout",
      lastDiagnosticDetail: detail,
      errorMessage: stringifyCommandError({
        code: "fallback_to_bridge",
        stage: "switched-to-bridge",
        message: "Direct cloud execution timed out. Switched to local bridge.",
        detail,
        fallback: "local-bridge"
      })
    });
  }

  return createFailedMaintenanceState(command, nowIso, {
    timeoutPhase: "result-timeout",
    lastDiagnosticCode: "cloud_result_timeout",
    lastDiagnosticDetail: detail,
    errorMessage: stringifyCommandError({
      code: "cloud_result_timeout",
      stage: "cloud-result-timeout",
      message: "Direct cloud execution did not produce a result in time.",
      detail
    })
  });
}

function evaluateBridgeMaintenance(command, nowIso, options = {}) {
  if (command.dispatchMode !== DISPATCH_MODE_LOCAL) {
    return command;
  }

  const fallbackAllowed = canFallbackToSlack(command, options);
  const hasFreshProcessingBridgeCommand = Boolean(options.hasFreshProcessingBridgeCommand);

  if (command.status === "queued") {
    if (hasFreshProcessingBridgeCommand) {
      return command;
    }

    if (!isOlderThan(command.progressUpdatedAt || command.createdAt, BRIDGE_CLAIM_TIMEOUT_MS)) {
      return command;
    }

  if (fallbackAllowed) {
    return createFallbackState(command, DISPATCH_MODE_CLOUD, nowIso, {
      progressStage: "switched-to-cloud",
      timeoutPhase: "claim-timeout",
      fallbackReason: "local bridge did not claim the command in time",
      lastDiagnosticCode: "bridge_claim_timeout",
      lastDiagnosticDetail: "The local bridge did not claim the command before the claim timeout.",
      errorMessage: stringifyCommandError({
        code: "fallback_to_cloud",
        stage: "switched-to-cloud",
        message: "Local bridge did not claim the command in time. Switched to trusted cloud.",
        detail: "The local bridge did not claim the command before the claim timeout.",
        fallback: "trusted-codex-cloud"
      })
    });
  }

    return createFailedMaintenanceState(command, nowIso, {
      timeoutPhase: "claim-timeout",
      lastDiagnosticCode: "bridge_claim_timeout",
      lastDiagnosticDetail: "The local bridge did not claim the command before the claim timeout.",
      actualExecutor: "bridge",
      errorMessage: stringifyCommandError({
        code: "bridge_claim_timeout",
        stage: "bridge-claim-timeout",
        message: "Local bridge did not claim the command in time.",
        detail: "The local bridge did not claim the command before the claim timeout."
      })
    });
  }

  if (command.status !== "processing") {
    return command;
  }

  const leaseUntil = Date.parse(String(command.processingLeaseUntil || "").trim());
  const staleSince = command.progressUpdatedAt || command.firstAckAt || command.processingStartedAt || command.createdAt;
  const isLeaseExpired = !Number.isNaN(leaseUntil) && leaseUntil <= Date.now();
  const isResultStale = isOlderThan(staleSince, BRIDGE_RESULT_TIMEOUT_MS);

  if (!isLeaseExpired && !isResultStale) {
    return command;
  }

  const detail = isLeaseExpired
    ? "The local bridge lease expired before the command completed."
    : "The local bridge stopped heartbeating before the command completed.";

  if (fallbackAllowed) {
    return createFallbackState(command, DISPATCH_MODE_CLOUD, nowIso, {
      progressStage: "switched-to-cloud",
      timeoutPhase: "result-timeout",
      fallbackReason: "local bridge stopped heartbeating",
      lastDiagnosticCode: "bridge_result_timeout",
      lastDiagnosticDetail: detail,
      errorMessage: stringifyCommandError({
        code: "fallback_to_cloud",
        stage: "switched-to-cloud",
        message: "Local bridge timed out. Switched to trusted cloud.",
        detail,
        fallback: "trusted-codex-cloud"
      })
    });
  }

  return createFailedMaintenanceState(command, nowIso, {
    timeoutPhase: "result-timeout",
    lastDiagnosticCode: "bridge_result_timeout",
    lastDiagnosticDetail: detail,
    actualExecutor: "bridge",
    errorMessage: stringifyCommandError({
      code: "bridge_result_timeout",
      stage: "bridge-result-timeout",
      message: "Local bridge did not finish the command in time.",
      detail
    })
  });
}

export async function runCommandMaintenance(env, options = {}) {
  const current = await readCommands(env);
  const nowIso = new Date().toISOString();
  let changedCount = 0;
  const commandsToDispatch = [];
  const hasFreshProcessingBridgeCommand = current.some((command) => {
    if (command.dispatchMode !== DISPATCH_MODE_LOCAL || command.status !== "processing") {
      return false;
    }

    const leaseUntil = Date.parse(String(command.processingLeaseUntil || "").trim());
    const staleSince = command.progressUpdatedAt || command.firstAckAt || command.processingStartedAt || command.createdAt;
    const isLeaseExpired = !Number.isNaN(leaseUntil) && leaseUntil <= Date.now();
    const isResultStale = isOlderThan(staleSince, BRIDGE_RESULT_TIMEOUT_MS);

    return !isLeaseExpired && !isResultStale;
  });

  const next = current.map((command) => {
    const previous = command;
    let updated = command;

    if (command.dispatchMode === DISPATCH_MODE_CLOUD) {
      updated = evaluateCloudMaintenance(command, nowIso, options);
    } else if (command.dispatchMode === DISPATCH_MODE_LOCAL) {
      updated = evaluateBridgeMaintenance(command, nowIso, {
        ...options,
        hasFreshProcessingBridgeCommand
      });
    }

    if (updated !== previous) {
      changedCount += 1;
    }

    if (
      updated.dispatchMode !== DISPATCH_MODE_LOCAL
      && updated.status === "queued"
      && (
        updated.dispatchMode === DISPATCH_MODE_CLOUD
        || !String(updated.slackChannelId || "").trim()
      )
    ) {
      commandsToDispatch.push(updated.id);
    }

    return updated;
  });

  if (changedCount) {
    await writeCommands(env, next);
  }

  return {
    changed: changedCount > 0,
    changedCount,
    commands: next,
    commandsToDispatch
  };
}

export async function recoverStaleCommands(env, options = {}) {
  const result = await runCommandMaintenance(env, options);
  return result.changed;
}

export async function getCommandsForClient(env, clientId) {
  const normalizedClientId = normalizeClientId(clientId);

  if (!normalizedClientId) {
    return [];
  }

  const indexedIds = await readIdIndex(env, commandClientIndexKey(normalizedClientId)).catch(() => []);

  if (indexedIds.length) {
    const commands = await readStoredCommandsByIds(env, indexedIds);
    return commands
      .map((command) => normalizeStoredCommandEntry(command))
      .filter(Boolean)
      .filter((command) => command.clientId === normalizedClientId)
      .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
  }

  const commands = await readCommands(env);
  return commands.filter((command) => command.clientId === normalizedClientId);
}

export async function getCommandById(env, id) {
  const normalizedId = String(id || "").trim();

  if (!normalizedId) {
    return null;
  }

  const direct = await readStoredCommand(env, normalizedId);

  if (direct) {
    return normalizeStoredCommandEntry(direct);
  }

  const commands = await readCommands(env);
  return commands.find((command) => command.id === normalizedId) || null;
}

export async function readActiveCommands(env) {
  const activeIds = await readIdIndex(env, COMMAND_ACTIVE_STORAGE_KEY).catch(() => []);

  if (!activeIds.length) {
    const commands = await readCommands(env);
    return commands.filter((command) => isActiveCommandStatus(command.status));
  }

  return (await readStoredCommandsByIds(env, activeIds))
    .map((command) => normalizeStoredCommandEntry(command))
    .filter(Boolean)
    .filter((command) => isActiveCommandStatus(command.status))
    .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
}

export async function listCommandThreads(env) {
  const commands = await readCommands(env);
  const threads = new Map();

  commands.forEach((command) => {
    const threadId = normalizeThreadId(command.threadId);
    const threadLabel = normalizeThreadLabel(command.threadLabel, threadId);

    if (!threadId || threads.has(threadId)) {
      return;
    }

    threads.set(threadId, {
      id: threadId,
      label: threadLabel
    });
  });

  if (!threads.size) {
    threads.set("links", {
      id: "links",
      label: "Links"
    });
  }

  return [...threads.values()].sort((left, right) => left.label.localeCompare(right.label, "ru"));
}
