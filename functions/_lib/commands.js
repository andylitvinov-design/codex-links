import {
  COMMAND_PROCESSING_LEASE_MS,
  COMMANDS_STORAGE_KEY,
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

function normalizeActualExecutionMode(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  return value === "cloud" || value === "bridge" ? value : "";
}

function normalizeReplyMatchedBy(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();

  if (value === "thread" || value === "unthreaded-fallback" || value === "manual-sync" || value === "direct-api") {
    return value;
  }

  return "";
}

function dispatchModeToExecutionMode(rawValue) {
  return normalizeDispatchValue(rawValue) === DISPATCH_MODE_SLACK ? "cloud" : "bridge";
}

function normalizeBooleanValue(rawValue, fallback = false) {
  return typeof rawValue === "boolean" ? rawValue : fallback;
}

function normalizeDiagnosticText(rawValue, max = 240) {
  return String(rawValue || "").trim().slice(0, max);
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
    actualExecutor: normalizedActualExecutor,
    actualDispatchMode: normalizedActualExecutor,
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
    photo: compactPhotoForStorage(command.photo, keepPhotoData)
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

function getCommandThreadKey(command) {
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

    if (!["queued", "dispatched", "processing", "answered", "acked"].includes(normalizeCommandStatus(command.status))) {
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
      actualExecutor: "",
      actualDispatchMode: "",
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
  const existing = await env.LINKS_STORE.get(COMMANDS_STORAGE_KEY, "json");

  if (!Array.isArray(existing)) {
    return [];
  }

  return existing
    .filter((entry) => entry && typeof entry === "object" && typeof entry.text === "string")
    .map((entry) => ({
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
      actualExecutor: normalizeActualExecutionMode(entry.actualExecutor || entry.actualDispatchMode),
      actualDispatchMode: normalizeActualExecutionMode(entry.actualExecutor || entry.actualDispatchMode),
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
    }))
    .filter((entry) => isWithinRetentionWindow(entry.createdAt))
    .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
}

export async function writeCommands(env, commands) {
  const trimmed = commands
    .map((command) => compactCommandForStorage(command))
    .filter((command) => isWithinRetentionWindow(command?.createdAt))
    .slice(-MAX_COMMANDS);
  await env.LINKS_STORE.put(COMMANDS_STORAGE_KEY, JSON.stringify(trimmed));
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

  const current = await readCommands(env);
  const duplicate = findRecentDuplicate(current, normalized.value);

  if (duplicate) {
    return {
      ok: true,
      value: duplicate
    };
  }

  current.push(normalized.value);
  await writeCommands(env, current);

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

  const current = await readCommands(env);
  const recovered = current.map((command) => {
    if (command.dispatchMode !== DISPATCH_MODE_LOCAL) {
      return command;
    }

    if (command.status !== "processing") {
      return command;
    }

    const leaseDeadline = Date.parse(String(command.processingLeaseUntil || "").trim());

    if (!Number.isNaN(leaseDeadline) && leaseDeadline > now) {
      return command;
    }

    return {
      ...command,
      status: "queued",
      progressStage: "queued",
      progressUpdatedAt: nowIso,
      processingStartedAt: "",
      processingLeaseUntil: "",
      processorId: ""
    };
  });

  const activeThreadKeys = new Set(
    recovered
      .filter((command) => command.status === "processing")
      .map((command) => getCommandThreadKey(command))
      .filter((value) => value !== "::")
  );

  const next = [...recovered];
  const duplicateIndexesToAck = new Set();
  const seenRecentIntentKeys = new Set();

  for (let index = next.length - 1; index >= 0; index -= 1) {
    const command = next[index];
    const status = normalizeCommandStatus(command?.status);

    if (!["queued", "dispatched", "processing", "answered", "acked"].includes(status)) {
      continue;
    }

    if (!isRecentEnough(command.createdAt, SUPERSEDED_DUPLICATE_WINDOW_MS)) {
      continue;
    }

    const intentKey = getCommandIntentKey(command);

    if (!intentKey) {
      continue;
    }

    if (status === "queued" && seenRecentIntentKeys.has(intentKey)) {
      duplicateIndexesToAck.add(index);
      continue;
    }

    seenRecentIntentKeys.add(intentKey);
  }

  for (const index of duplicateIndexesToAck) {
    next[index] = markCommandAcked(next[index], nowIso);
  }

  const nextIndex = next.findIndex((command) => {
    if (command.dispatchMode !== DISPATCH_MODE_LOCAL) {
      return false;
    }

    if (command.status !== "queued") {
      return false;
    }

    const threadKey = getCommandThreadKey(command);

    if (threadKey !== "::" && activeThreadKeys.has(threadKey)) {
      return false;
    }

    return true;
  });

  if (nextIndex === -1) {
    await writeCommands(env, next);
    return {
      ok: true,
      value: null
    };
  }

  const claimed = {
    ...next[nextIndex],
    status: "processing",
    progressStage: "accepted",
    progressUpdatedAt: nowIso,
    firstAckAt: next[nextIndex].firstAckAt || nowIso,
    actualExecutor: "bridge",
    actualDispatchMode: "bridge",
    dispatchStartedAt: next[nextIndex].dispatchStartedAt || nowIso,
    bridgeClaimedAt: next[nextIndex].bridgeClaimedAt || nowIso,
    firstExecutorAckSeenAt: next[nextIndex].firstExecutorAckSeenAt || nowIso,
    processingStartedAt: nowIso,
    processingLeaseUntil: leaseUntil,
    processorId
  };

  next[nextIndex] = claimed;
  await writeCommands(env, next);

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
      fallbackApplied: true,
      fallbackCount: Math.min(1, Number(command?.fallbackCount || 0) + 1),
      fallbackReason: input.fallbackReason || command.fallbackReason,
      timeoutPhase: Object.prototype.hasOwnProperty.call(input, "timeoutPhase") ? input.timeoutPhase : command.timeoutPhase,
      lastDiagnosticCode: input.lastDiagnosticCode || command.lastDiagnosticCode,
      lastDiagnosticDetail: input.lastDiagnosticDetail || command.lastDiagnosticDetail
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
    replyIngestedAt: ""
  }));
}

export async function rerouteCommandToLocalBridge(env, input = {}) {
  return updateCommand(env, input.id, (command, nowIso) => ({
    ...command,
    ...mergeCommandDebugState(command, {
      actualExecutor: "bridge",
      fallbackApplied: true,
      fallbackCount: Math.min(1, Number(command?.fallbackCount || 0) + 1),
      fallbackReason: input.fallbackReason || command.fallbackReason,
      timeoutPhase: Object.prototype.hasOwnProperty.call(input, "timeoutPhase") ? input.timeoutPhase : command.timeoutPhase,
      lastDiagnosticCode: input.lastDiagnosticCode || command.lastDiagnosticCode,
      lastDiagnosticDetail: input.lastDiagnosticDetail || command.lastDiagnosticDetail
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
    replyIngestedAt: ""
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
    replyIngestedAt: ""
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

  const nowIso = new Date().toISOString();
  const current = await readCommands(env);
  let updated = null;

  const next = current.map((command) => {
    if (command.id !== normalizedId) {
      return command;
    }

    updated = updater(command, nowIso);
    return updated || command;
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

export async function markCommandDispatched(env, input = {}) {
  const dispatchMode = normalizeDispatchValue(input.dispatchMode);
  return updateCommand(env, input.id, (command, nowIso) => ({
    ...command,
    ...mergeCommandDebugState(command, {
      actualExecutor: "",
      slackDispatchAttempted: true,
      slackDispatchSucceeded: dispatchMode === DISPATCH_MODE_SLACK,
      timeoutPhase: "",
      resultAt: "",
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
    completedAt: ""
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
  return Boolean(options.preferSlack)
    && Number(command?.fallbackCount || 0) < 1
    && !command?.photo
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
    replyIngestedAt: ""
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

  if (command.status === "queued") {
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
          message: "Local bridge did not claim the command in time. Switched to direct cloud execution.",
          detail: "The local bridge did not claim the command before the claim timeout.",
          fallback: "cloud"
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
        message: "Local bridge timed out. Switched to direct cloud execution.",
        detail,
        fallback: "cloud"
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

  const next = current.map((command) => {
    const previous = command;
    let updated = command;

    if (command.dispatchMode === DISPATCH_MODE_SLACK) {
      updated = evaluateCloudMaintenance(command, nowIso, options);
    } else if (command.dispatchMode === DISPATCH_MODE_LOCAL) {
      updated = evaluateBridgeMaintenance(command, nowIso, options);
    }

    if (updated !== previous) {
      changedCount += 1;

      if (
        updated.dispatchMode === DISPATCH_MODE_SLACK
        && updated.status === "queued"
        && !String(updated.slackChannelId || "").trim()
      ) {
        commandsToDispatch.push(updated.id);
      }
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

  const commands = await readCommands(env);
  return commands.filter((command) => command.clientId === normalizedClientId);
}

export async function getCommandById(env, id) {
  const normalizedId = String(id || "").trim();

  if (!normalizedId) {
    return null;
  }

  const commands = await readCommands(env);
  return commands.find((command) => command.id === normalizedId) || null;
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
