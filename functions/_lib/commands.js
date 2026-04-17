import {
  COMMAND_PROCESSING_LEASE_MS,
  COMMANDS_STORAGE_KEY,
  HISTORY_RETENTION_MS,
  MAX_COMMANDS
} from "./constants.js";
import { DISPATCH_MODE_LOCAL, DISPATCH_MODE_SLACK, normalizeDispatchMode } from "./dispatch.js";

const RECENT_DUPLICATE_WINDOW_MS = 5 * 60 * 1000;
const SUPERSEDED_DUPLICATE_WINDOW_MS = 15 * 60 * 1000;
const STALE_SLACK_DISPATCH_MS = 90 * 1000;
const STALE_SLACK_PROCESSING_MS = 20 * 60 * 1000;

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

function normalizeDispatchValue(rawDispatchMode) {
  return normalizeDispatchMode(rawDispatchMode || DISPATCH_MODE_LOCAL);
}

function normalizeSlackValue(rawValue) {
  return String(rawValue || "").trim().slice(0, 120);
}

function normalizeErrorMessage(rawValue) {
  return String(rawValue || "").trim().slice(0, 500);
}

function normalizeDateValue(rawValue) {
  return String(rawValue || "").trim().slice(0, 80);
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
      photo: normalizedPhoto?.value || null,
      createdAt: new Date().toISOString(),
      status: "queued",
      progressStage: "queued",
      progressUpdatedAt: new Date().toISOString(),
      source: "site",
      dispatchMode: normalizeDispatchValue(input.dispatchMode),
      slackChannelId: "",
      slackMessageTs: "",
      slackThreadTs: "",
      prUrl: "",
      branchName: "",
      errorMessage: "",
      dispatchedAt: "",
      completedAt: ""
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
      dispatchMode: normalizeDispatchValue(entry.dispatchMode),
      slackChannelId: normalizeSlackValue(entry.slackChannelId),
      slackMessageTs: normalizeSlackValue(entry.slackMessageTs),
      slackThreadTs: normalizeSlackValue(entry.slackThreadTs),
      prUrl: String(entry.prUrl || "").trim(),
      branchName: normalizeSlackValue(entry.branchName),
      errorMessage: normalizeErrorMessage(entry.errorMessage),
      dispatchedAt: normalizeDateValue(entry.dispatchedAt),
      completedAt: normalizeDateValue(entry.completedAt)
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
    progressStage: "claimed",
    progressUpdatedAt: nowIso,
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
    dispatchMode: DISPATCH_MODE_LOCAL,
    status: "queued",
    progressStage: normalizeProgressStage(input.progressStage) || "queued",
    progressUpdatedAt: nowIso,
    slackChannelId: "",
    slackMessageTs: "",
    slackThreadTs: "",
    errorMessage: normalizeErrorMessage(input.errorMessage),
    dispatchedAt: "",
    processingStartedAt: "",
    processingLeaseUntil: "",
    processorId: "",
    completedAt: ""
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
  return updateCommand(env, input.id, (command, nowIso) => ({
    ...command,
    dispatchMode: normalizeDispatchValue(input.dispatchMode || command.dispatchMode),
    status: "processing",
    progressStage: "processing",
    progressUpdatedAt: nowIso,
    slackChannelId: normalizeSlackValue(input.slackChannelId),
    slackMessageTs: normalizeSlackValue(input.slackMessageTs),
    slackThreadTs: normalizeSlackValue(input.slackThreadTs || input.slackMessageTs),
    dispatchedAt: normalizeDateValue(input.dispatchedAt) || nowIso,
    errorMessage: "",
    processorId: "",
    processingStartedAt: "",
    processingLeaseUntil: ""
  }));
}

export async function markCommandAnswered(env, input = {}) {
  return updateCommand(env, input.id, (command, nowIso) => ({
    ...command,
    status: "answered",
    progressStage: normalizeProgressStage(input.progressStage) || "answered",
    progressUpdatedAt: nowIso,
    prUrl: String(input.prUrl || command.prUrl || "").trim(),
    branchName: normalizeSlackValue(input.branchName || command.branchName),
    completedAt: normalizeDateValue(input.completedAt) || nowIso,
    errorMessage: ""
  }));
}

export async function markCommandFailed(env, input = {}) {
  return updateCommand(env, input.id, (command, nowIso) => ({
    ...command,
    status: "failed",
    progressStage: normalizeProgressStage(input.progressStage) || "failed",
    progressUpdatedAt: nowIso,
    errorMessage: normalizeErrorMessage(input.errorMessage),
    completedAt: normalizeDateValue(input.completedAt) || nowIso
  }));
}

export async function upsertCommandDispatchState(env, input = {}) {
  const nextStatus = normalizeCommandStatus(input.status);

  return updateCommand(env, input.id, (command, nowIso) => ({
    ...command,
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
    processingStartedAt: nextStatus === "processing"
      ? (normalizeDateValue(input.processingStartedAt) || command.processingStartedAt || nowIso)
      : command.processingStartedAt,
    completedAt: nextStatus === "answered" || nextStatus === "failed"
      ? (normalizeDateValue(input.completedAt) || command.completedAt || nowIso)
      : command.completedAt
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

export async function recoverStaleSlackCommands(env) {
  const current = await readCommands(env);
  const nowIso = new Date().toISOString();
  let changed = false;

  const next = current.map((command) => {
    if (command.dispatchMode !== DISPATCH_MODE_SLACK) {
      return command;
    }

    if (command.status === "dispatched") {
      const staleSince = command.dispatchedAt || command.createdAt;

      if (!isOlderThan(staleSince, STALE_SLACK_DISPATCH_MS)) {
        return command;
      }

      changed = true;
      return {
        ...command,
        dispatchMode: DISPATCH_MODE_LOCAL,
        status: "queued",
        progressStage: "queued",
        progressUpdatedAt: nowIso,
        slackChannelId: "",
        slackMessageTs: "",
        slackThreadTs: "",
        errorMessage: "Slack dispatch timed out before Codex acknowledged the task. Falling back to local bridge.",
        dispatchedAt: "",
        processingStartedAt: "",
        processingLeaseUntil: "",
        processorId: "",
        completedAt: ""
      };
    }

    if (command.status === "processing") {
      const staleSince = command.progressUpdatedAt || command.processingStartedAt || command.dispatchedAt || command.createdAt;

      if (!isOlderThan(staleSince, STALE_SLACK_PROCESSING_MS)) {
        return command;
      }

      changed = true;
      return {
        ...command,
        dispatchMode: DISPATCH_MODE_LOCAL,
        status: "queued",
        progressStage: "queued",
        progressUpdatedAt: nowIso,
        slackChannelId: "",
        slackMessageTs: "",
        slackThreadTs: "",
        errorMessage: "Slack processing timed out. Falling back to local bridge.",
        dispatchedAt: "",
        processingStartedAt: "",
        processingLeaseUntil: "",
        processorId: "",
        completedAt: ""
      };
    }

    return command;
  });

  if (changed) {
    await writeCommands(env, next);
  }

  return changed;
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
