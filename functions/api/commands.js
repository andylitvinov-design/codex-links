import {
  acknowledgeCommands,
  claimNextCommand,
  fallbackCommandToLocalBridge,
  markCommandAnswered,
  markCommandDispatched,
  markCommandFailed,
  getCommandById,
  getCommandsForClient,
  insertCommand,
  listCommandThreads,
  requeueCommand,
  readCommands,
  upsertCommandDispatchState,
  updateCommandProgress,
  writeCommands
} from "../_lib/commands.js";
import { handleOptions, json, jsonStorageError } from "../_lib/http.js";
import {
  DISPATCH_MODE_CLOUD,
  DISPATCH_MODE_LOCAL,
  DISPATCH_MODE_SLACK,
  getConfiguredDispatchMode,
  getDispatchModeLabel,
  isCloudDispatchConfigured,
  getSlackCodexMention
} from "../_lib/dispatch.js";
import { isAuthorized } from "../_lib/security.js";
import { deriveSlackReplyOutcome, fetchSlackChannelMessages, fetchSlackThreadReplies, inspectSlackPhotoDelivery, isLikelyCodexSlackActor, postSlackCommand } from "../_lib/slack.js";
import { isIgnorableSlackReplyText } from "../_lib/slack.js";
import { upsertMessages } from "../_lib/messages.js";
import { refreshBridgeStatusFromCommands } from "../_lib/status.js";
import { readRuntimeConfig } from "../_lib/config.js";
import { stringifyCommandError } from "../_lib/command-debug.js";
import { submitTrustedCloudCommand } from "../_lib/trusted-cloud-bridge.js";
import { resolveProjectDispatchTarget } from "../_lib/project-dispatch-manifest.js";
import {
  buildLatencyBreakdown,
  getVisibleDeliveryStage,
  storeSlackActiveChannelCommand,
  storeSlackThreadCommandMap
} from "../_lib/delivery.js";

const MAX_RECENT_SLACK_SYNC_COMMANDS = 20;
const SLACK_RESULT_WAIT_MS = 3 * 60_000;

function isSlackCloudDiagnosticsEnabled(runtimeConfig) {
  const value = String(runtimeConfig?.SLACK_CLOUD_DIAGNOSTICS || "").trim().toLowerCase();
  return value === "1" || value === "true";
}

function mergeDeliveryEvidence(command, incoming = {}, runtimeConfig = {}) {
  const current = command?.deliveryEvidence && typeof command.deliveryEvidence === "object"
    ? command.deliveryEvidence
    : {};
  const next = incoming && typeof incoming === "object" ? incoming : {};
  const diagnosticsEnabled = isSlackCloudDiagnosticsEnabled(runtimeConfig);
  const nowIso = new Date().toISOString();
  const merged = {
    ...current,
    ...next
  };

  if (!merged.inspectedAt) {
    merged.inspectedAt = nowIso;
  }

  if (diagnosticsEnabled) {
    merged.matchedChannelId = String(
      next.matchedChannelId || current.matchedChannelId || command?.slackChannelId || ""
    ).trim();
    merged.matchedThreadTs = String(
      next.matchedThreadTs || current.matchedThreadTs || command?.slackThreadTs || command?.slackMessageTs || ""
    ).trim();
  }

  return merged;
}

function isOlderThan(value, maxAgeMs) {
  const timestamp = Date.parse(String(value || "").trim());

  if (Number.isNaN(timestamp)) {
    return false;
  }

  return Date.now() - timestamp > maxAgeMs;
}

function resolveRequestedDispatchMode(payload, runtimeConfig) {
  const requestedExecutor = String(
    payload?.targetExecutionMode
    || payload?.requestedExecutor
    || payload?.requestedMode
    || ""
  ).trim().toLowerCase();
  const requestedDispatchMode = String(payload?.dispatchMode || "").trim().toLowerCase();
  const configuredDispatchMode = getConfiguredDispatchMode(runtimeConfig);

  if (requestedDispatchMode === DISPATCH_MODE_LOCAL || requestedExecutor === "bridge") {
    return DISPATCH_MODE_LOCAL;
  }

  if (
    requestedDispatchMode === DISPATCH_MODE_CLOUD
    || requestedDispatchMode === DISPATCH_MODE_SLACK
    || requestedDispatchMode === "direct-openai"
    || requestedDispatchMode === "cloud-via-slack"
    || requestedExecutor === "cloud"
  ) {
    return DISPATCH_MODE_CLOUD;
  }

  return configuredDispatchMode;
}

function resolveCommandMode(payload, runtimeConfig) {
  const requested = String(payload?.mode || "").trim().toLowerCase();

  if (requested === "compat") {
    return "compat";
  }

  const configValue = String(runtimeConfig?.CLOUD_PHOTO_COMPAT_MODE || "").trim().toLowerCase();
  return configValue === "1" || configValue === "true" ? "compat" : "default";
}

function isCompatCloudPhotoEnabled(command, runtimeConfig) {
  const photoAttached = Boolean(command?.photoAttached || command?.photo || command?.photoBytesPresent);
  const mode = String(command?.mode || "").trim().toLowerCase();
  const configValue = String(runtimeConfig?.CLOUD_PHOTO_COMPAT_MODE || "").trim().toLowerCase();

  return photoAttached && (
    mode === "compat"
    || configValue === "1"
    || configValue === "true"
  );
}

function normalizeEntryText(entry) {
  return String(entry?.text || "").trim().toLowerCase();
}

function isHiddenJunkFeedText(text) {
  const normalized = String(text || "").trim().toLowerCase();
  const allowedTokens = new Set(["photo", "repro", "ignore", "test", "probe"]);

  if (!normalized) {
    return false;
  }

  if (/^(?:photo|repro|ignore)(?:\s+(?:photo|repro|ignore))*$/i.test(normalized)) {
    return true;
  }

  const tokens = normalized
    .replace(/[^a-z\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  return tokens.length > 0
    && tokens.length <= 6
    && tokens.every((token) => allowedTokens.has(token))
    && tokens.includes("ignore")
    && (tokens.includes("photo") || tokens.includes("repro"));
}

function isProductionVerificationProbe(text) {
  return text.includes("production")
    && (
      text.includes("verification")
      || text.includes("route check")
      || text.includes(" ping")
    )
    && (
      text.includes("ignore if seen")
      || text.includes("reply with ok only")
    );
}

function isHiddenPublicCommand(entry) {
  const text = normalizeEntryText(entry);

  return (
    isHiddenJunkFeedText(text)
    || isProductionVerificationProbe(text)
    || text.includes("delivery-probe")
    || text.includes("local bridge probe")
    || text.includes("probe reply with ok only")
    || text.includes("dedupe test ignore")
    || text.includes("codex cloud routing probe ignore")
    || text.includes("test command from site api")
    || text.includes("direct deploy command test")
    || text.includes("ready check command")
  );
}

function filterPublicCommands(commands) {
  return (Array.isArray(commands) ? commands : []).filter((command) => !isHiddenPublicCommand(command));
}

function serializeCommand(command, options = {}) {
  if (!command || typeof command !== "object") {
    return command;
  }

  const includePhotoData = Boolean(options.includePhotoData);
  const photo = command.photo && typeof command.photo === "object"
    ? {
        contentType: String(command.photo.contentType || "").trim(),
        fileName: String(command.photo.fileName || "").trim(),
        size: Number(command.photo.size || 0),
        hasDataUrl: Boolean(String(command.photo.dataUrl || "").trim()),
        ...(includePhotoData && String(command.photo.dataUrl || "").trim()
          ? { dataUrl: String(command.photo.dataUrl || "").trim() }
          : {})
      }
    : null;

  return {
    ...command,
    deliveryStage: getVisibleDeliveryStage(command),
    latencyBreakdown: buildLatencyBreakdown(command),
    photo,
    photoAttached: Boolean(command.photoAttached),
    photoBytesPresent: Boolean(command.photoBytesPresent),
    photoSeenByBridge: Boolean(command.photoSeenByBridge),
    photoProcessed: Boolean(command.photoProcessed),
    photoUnsupportedReason: String(command.photoUnsupportedReason || "").trim(),
    projectId: String(command.projectId || "").trim(),
    projectLabel: String(command.projectLabel || "").trim(),
    projectCategory: String(command.projectCategory || "").trim(),
    targetRepo: String(command.targetRepo || "").trim(),
    targetRepoUrl: String(command.targetRepoUrl || "").trim(),
    targetContextFiles: Array.isArray(command.targetContextFiles) ? command.targetContextFiles : [],
    targetWorkspacePath: String(command.targetWorkspacePath || "").trim(),
    targetExecutionMode: String(command.targetExecutionMode || "").trim()
  };
}

function serializeCommands(commands, options = {}) {
  return (Array.isArray(commands) ? commands : []).map((command) => serializeCommand(command, options));
}

export async function syncSlackCommandReplies(env, command, runtimeConfig, options = {}) {
  const channelId = String(command?.slackChannelId || "").trim();
  const threadTs = String(command?.slackThreadTs || command?.slackMessageTs || "").trim();

  if (!channelId || !threadTs) {
    return false;
  }

  const replies = await fetchSlackThreadReplies(env, channelId, threadTs);
  const rootTs = String(command?.slackMessageTs || "").trim();
  const threadReplies = replies.filter((reply) => (
    reply.ts
    && reply.ts !== rootTs
    && reply.text
    && !isIgnorableSlackReplyText(reply.text)
  ));

  let latestReply = threadReplies.at(-1) || null;
  let progressStage = "slack-reply-received";

  if (!latestReply) {
    const channelMessages = await fetchSlackChannelMessages(env, channelId, {
      oldest: command.dispatchedAt || command.createdAt
    });
    const unthreadedReplies = channelMessages.filter((reply) =>
      reply.ts
      && reply.ts !== rootTs
      && reply.text
      && !isIgnorableSlackReplyText(reply.text)
      && (!reply.threadTs || reply.threadTs === reply.ts)
      && isLikelyCodexSlackActor(runtimeConfig, reply, { candidateCount: 1 })
    );

    latestReply = unthreadedReplies.at(0) || null;
    progressStage = latestReply ? "slack-reply-received-unthreaded" : progressStage;
  }

  if (!latestReply) {
    return false;
  }

  const classification = deriveSlackReplyOutcome(command, latestReply.text);
  const hasValidExecutionAck = classification.executionAckValid;
  const resolvedProgressStage = progressStage === "slack-reply-received-unthreaded"
    ? progressStage
    : (classification.progressStage || progressStage);

  await upsertCommandDispatchState(env, {
    id: command.id,
    dispatchMode: DISPATCH_MODE_SLACK,
    status: classification.status,
    progressStage: resolvedProgressStage,
    actualExecutor: "cloud",
    slackReplyReceived: true,
    slackReplyThreaded: progressStage !== "slack-reply-received-unthreaded",
    replyMatched: true,
    replyMatchedBy: options.replyMatchedBy || (progressStage === "slack-reply-received-unthreaded" ? "manual-sync" : "thread"),
    firstAckAt: hasValidExecutionAck ? (command.firstAckAt || new Date().toISOString()) : command.firstAckAt,
    timeoutPhase: "",
    lastDiagnosticCode: classification.lastDiagnosticCode || (progressStage === "slack-reply-received-unthreaded" ? "slack_reply_unthreaded" : ""),
    lastDiagnosticDetail: classification.lastDiagnosticDetail || (progressStage === "slack-reply-received-unthreaded"
      ? "A Codex reply arrived outside the original Slack thread and was reconciled from recent channel history."
      : ""),
    slackChannelId: channelId,
    slackThreadTs: progressStage === "slack-reply-received-unthreaded"
      ? (latestReply.threadTs || latestReply.ts || threadTs)
      : threadTs,
    slackMessageTs: rootTs,
    prUrl: classification.prUrl,
    branchName: classification.branchName,
    errorMessage: classification.status === "failed" ? latestReply.text : "",
    processingStartedAt: classification.status === "processing" ? new Date().toISOString() : "",
    resultAt: classification.status === "answered" || classification.status === "failed" ? new Date().toISOString() : "",
    firstExecutorAckSeenAt: hasValidExecutionAck ? (command.firstExecutorAckSeenAt || new Date().toISOString()) : command.firstExecutorAckSeenAt
  });

  await upsertMessages(env, [latestReply].map((reply) => ({
    id: `slack:${channelId}:${reply.ts}`,
    clientId: command.clientId,
    threadId: command.threadId,
    threadLabel: command.threadLabel,
    commandId: command.id,
    role: "assistant",
    text: reply.text,
    createdAt: new Date(Number(reply.ts) * 1000 || Date.now()).toISOString()
  })));

  await refreshBridgeStatusFromCommands(env, {
    dispatchMode: DISPATCH_MODE_SLACK,
    executorLabel: getDispatchModeLabel(DISPATCH_MODE_SLACK),
    bridgeOnline: true,
    state: classification.status === "processing" ? "running" : "idle",
    lastRunAt: new Date().toISOString(),
    lastSuccessAt: classification.status === "answered" ? new Date().toISOString() : undefined,
    lastDeliveredCount: classification.status === "answered" ? 1 : 0,
    lastError: classification.status === "failed" ? latestReply.text : ""
  });

  return classification.status === "answered" || classification.status === "failed";
}

export async function syncRecentSlackReplies(env, runtimeConfig) {
  if (!isSlackDispatchConfigured(runtimeConfig)) {
    return;
  }

  const commands = await readCommands(env);
  const candidates = commands
    .filter((command) => command.dispatchMode === DISPATCH_MODE_SLACK)
    .filter((command) => {
      const status = String(command?.status || "").trim().toLowerCase();
      return status === "dispatched" || status === "processing";
    })
    .filter((command) => String(command?.slackChannelId || "").trim() && String(command?.slackThreadTs || command?.slackMessageTs || "").trim())
    .sort((left, right) => String(right.progressUpdatedAt || right.dispatchedAt || right.createdAt || "").localeCompare(String(left.progressUpdatedAt || left.dispatchedAt || left.createdAt || "")))
    .slice(0, MAX_RECENT_SLACK_SYNC_COMMANDS);

  for (const command of candidates) {
    try {
      await syncSlackCommandReplies(env, command, runtimeConfig);
    } catch {}
  }
}

export async function syncSpecificSlackReplies(env, runtimeConfig, commands) {
  if (!isSlackDispatchConfigured(runtimeConfig)) {
    return;
  }

  const candidates = (Array.isArray(commands) ? commands : [])
    .filter((command) => command?.dispatchMode === DISPATCH_MODE_SLACK)
    .filter((command) => {
      const status = String(command?.status || "").trim().toLowerCase();
      return status === "dispatched" || status === "processing";
    })
    .filter((command) => String(command?.slackChannelId || "").trim() && String(command?.slackThreadTs || command?.slackMessageTs || "").trim())
    .sort((left, right) => String(right.progressUpdatedAt || right.dispatchedAt || right.createdAt || "").localeCompare(String(left.progressUpdatedAt || left.dispatchedAt || left.createdAt || "")))
    .slice(0, MAX_RECENT_SLACK_SYNC_COMMANDS);

  for (const command of candidates) {
    try {
      await syncSlackCommandReplies(env, command, runtimeConfig);
    } catch {}
  }
}

async function fallbackToLocalBridge(env, command, errorMessage) {
  const fallbackReason = typeof errorMessage === "string"
    ? errorMessage
    : String(errorMessage?.detail || errorMessage?.message || "").trim();
  const timeoutPhase = typeof errorMessage === "object" && errorMessage
    ? String(errorMessage.stage || "").trim().includes("reply") ? "first-reply-timeout" : ""
    : "";
  const normalizedErrorMessage = typeof errorMessage === "string"
    ? stringifyCommandError({
        code: "fallback_to_bridge",
        stage: "fallback-to-bridge",
        message: errorMessage,
        detail: errorMessage,
        fallback: "local-bridge"
      })
    : stringifyCommandError(errorMessage);
  const fallback = await fallbackCommandToLocalBridge(env, {
    id: command.id,
    progressStage: "fallback-to-bridge",
    mode: errorMessage?.mode,
    cloudInputUnverified: errorMessage?.cloudInputUnverified,
    deliveryStopPoint: errorMessage?.deliveryStopPoint,
    deliveryEvidence: errorMessage?.deliveryEvidence,
    errorMessage: normalizedErrorMessage,
    timeoutPhase,
    fallbackReason,
    lastDiagnosticCode: typeof errorMessage === "object" && errorMessage ? errorMessage.code : "",
    lastDiagnosticDetail: fallbackReason
  });

  await refreshBridgeStatusFromCommands(env, {
    dispatchMode: DISPATCH_MODE_LOCAL,
    executorLabel: getDispatchModeLabel(DISPATCH_MODE_LOCAL),
    bridgeOnline: true,
    lastRunAt: new Date().toISOString(),
    lastError: typeof errorMessage === "string" ? errorMessage : normalizedErrorMessage
  });

  return fallback.value || command;
}

function isFinalCommandStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  return normalized === "answered" || normalized === "failed" || normalized === "acked";
}

export function buildPhotoDeliveryTimeout(command, evidence, dispatchObservedAt) {
  if (!evidence) {
    return {
      progressStage: "failed",
      deliveryStopPoint: dispatchObservedAt ? "worker_reply_missing" : "slack_thread_missing",
      lastDiagnosticCode: "cloud_result_timeout",
      lastDiagnosticDetail: dispatchObservedAt
        ? "Slack dispatch succeeded, but photo delivery evidence could not confirm any worker reply."
        : "No Slack dispatch thread or Codex reply was observed within the Slack result wait window.",
      errorMessage: stringifyCommandError({
        code: "cloud_result_timeout",
        stage: "cloud-result-timeout",
        message: "Cloud via Slack did not produce a reply in time.",
        detail: dispatchObservedAt
          ? "Slack dispatch succeeded, but photo delivery evidence could not confirm any worker reply."
          : "No Slack dispatch thread or Codex reply was observed within the Slack result wait window."
      })
    };
  }

  if (!evidence.slackRootPosted && !evidence.threadRootSeen) {
    return {
      progressStage: "slack-waiting-ack",
      deliveryStopPoint: "slack_thread_missing",
      lastDiagnosticCode: "slack_thread_missing",
      lastDiagnosticDetail: "Slack dispatch did not leave a readable root thread for the photo command.",
      errorMessage: stringifyCommandError({
        code: "slack_thread_missing",
        stage: "slack-thread-missing",
        message: "Slack dispatch did not produce a readable thread.",
        detail: "Slack dispatch did not leave a readable root thread for the photo command."
      })
    };
  }

  if (!evidence.slackPhotoUploaded && !evidence.fileReplySeen && !evidence.fileId) {
    return {
      progressStage: "slack-waiting-ack",
      deliveryStopPoint: "slack_photo_uploaded_missing",
      lastDiagnosticCode: "slack_photo_uploaded_missing",
      lastDiagnosticDetail: "Slack thread exists, but the uploaded photo reply/file metadata was not found.",
      errorMessage: stringifyCommandError({
        code: "slack_photo_uploaded_missing",
        stage: "slack-photo-uploaded-missing",
        message: "Slack thread exists, but the uploaded photo was not discoverable.",
        detail: "Slack thread exists, but the uploaded photo reply/file metadata was not found."
      })
    };
  }

  if (
    evidence.fileId
    && (
      (evidence.fileAccess && evidence.fileAccess !== "visible")
      || evidence.botCanOpenFile === false
      || evidence.slackFileOpenOk === false
    )
  ) {
    return {
      progressStage: "slack-waiting-ack",
      deliveryStopPoint: "slack_file_open_failed",
      lastDiagnosticCode: "slack_file_open_failed",
      lastDiagnosticDetail: evidence.fileAccess && evidence.fileAccess !== "visible"
        ? `Slack file ${evidence.fileId || "unknown"} is not visible to readers.`
        : `Links bot could not open Slack file ${evidence.fileId || "unknown"} (HTTP ${evidence.botOpenHttpStatus || 0}).`,
      errorMessage: stringifyCommandError({
        code: "slack_file_open_failed",
        stage: "slack-file-open-failed",
        message: "Slack uploaded the photo, but authenticated file open failed.",
        detail: evidence.fileAccess && evidence.fileAccess !== "visible"
          ? `Slack file ${evidence.fileId || "unknown"} is not visible to readers.`
          : `Links bot could not open Slack file ${evidence.fileId || "unknown"} (HTTP ${evidence.botOpenHttpStatus || 0}).`
      })
    };
  }

  if (!evidence.workerReplySeen) {
    return {
      progressStage: "slack-waiting-ack",
      deliveryStopPoint: "worker_reply_missing",
      lastDiagnosticCode: "worker_reply_missing",
      lastDiagnosticDetail: "Slack thread and hosted file are readable, but the external worker never posted the first threaded reply.",
      errorMessage: stringifyCommandError({
        code: "worker_reply_missing",
        stage: "worker-reply-missing",
        message: "Slack file is available, but the external worker never started observably.",
        detail: "Slack thread and hosted file are readable, but the external worker never posted the first threaded reply."
      })
    };
  }

  if (!evidence.workerAckSeen && !evidence.executionAckSeen) {
    return {
      progressStage: "slack-waiting-ack",
      deliveryStopPoint: "worker_ack_missing",
      lastDiagnosticCode: "worker_ack_missing",
      lastDiagnosticDetail: "The external worker replied in-thread, but no structured CODEX_LINKS_EXECUTION_ACK was posted.",
      errorMessage: stringifyCommandError({
        code: "worker_ack_missing",
        stage: "worker-ack-missing",
        message: "The external worker replied, but structured startup ack is missing.",
        detail: "The external worker replied in-thread, but no structured CODEX_LINKS_EXECUTION_ACK was posted."
      })
    };
  }

  if (evidence.workerPhotoReadySeen || evidence.photoReadySeen) {
    return {
      progressStage: "failed",
      deliveryStopPoint: "cloud_result_timeout",
      lastDiagnosticCode: "cloud_result_timeout",
      lastDiagnosticDetail: "The external worker started and confirmed photo readiness, but no final reply arrived in time.",
      errorMessage: stringifyCommandError({
        code: "cloud_result_timeout",
        stage: "cloud-result-timeout",
        message: "Cloud via Slack did not produce a final reply in time.",
        detail: "The external worker started and confirmed photo readiness, but no final reply arrived in time."
      })
    };
  }

  return {
    progressStage: "waiting-photo-ready",
    deliveryStopPoint: "worker_photo_ready_missing",
    lastDiagnosticCode: "worker_photo_ready_missing",
    lastDiagnosticDetail: "Structured execution ack appeared, but photo_ready=true was not confirmed.",
    errorMessage: stringifyCommandError({
      code: "worker_photo_ready_missing",
      stage: "worker-photo-ready-missing",
      message: "Structured startup ack appeared without photo_ready=true.",
      detail: "Structured execution ack appeared, but photo_ready=true was not confirmed."
    })
  };
}

function buildSlackDeliveryTimeout(command, evidence, dispatchObservedAt) {
  const photoAttached = Boolean(command?.photoAttached || command?.photo || command?.photoBytesPresent);

  if (photoAttached) {
    return buildPhotoDeliveryTimeout(command, evidence, dispatchObservedAt);
  }

  if (String(command?.firstExecutorAckSeenAt || "").trim()) {
    return {
      progressStage: "failed",
      deliveryStopPoint: "cloud_result_timeout",
      lastDiagnosticCode: "cloud_result_timeout",
      lastDiagnosticDetail: "The external worker acknowledged startup, but no final reply arrived in time.",
      errorMessage: stringifyCommandError({
        code: "cloud_result_timeout",
        stage: "cloud-result-timeout",
        message: "Cloud via Slack did not produce a final reply in time.",
        detail: "The external worker acknowledged startup, but no final reply arrived in time."
      })
    };
  }

  return {
    progressStage: "failed",
    deliveryStopPoint: dispatchObservedAt ? "worker_reply_missing" : "slack_thread_missing",
    lastDiagnosticCode: "cloud_result_timeout",
    lastDiagnosticDetail: dispatchObservedAt
      ? "Slack dispatch succeeded, but no Codex reply was observed within the Slack result wait window."
      : "No Slack dispatch thread or Codex reply was observed within the Slack result wait window.",
    errorMessage: stringifyCommandError({
      code: "cloud_result_timeout",
      stage: "cloud-result-timeout",
      message: "Cloud via Slack did not produce a reply in time.",
      detail: dispatchObservedAt
        ? "Slack dispatch succeeded, but no Codex reply was observed within the Slack result wait window."
        : "No Slack dispatch thread or Codex reply was observed within the Slack result wait window."
    })
  };
}

function canFallbackToLocalBridge(command) {
  return Number(command?.fallbackCount || 0) < 1 && (
    (String(command?.threadId || "").trim() && !String(command?.threadId || "").trim().startsWith("cloud:"))
    || String(command?.fallbackThreadId || "").trim()
  );
}

async function markCloudCommandFailed(env, command, commandError) {
  const normalizedError = stringifyCommandError(commandError);
  const failed = await markCommandFailed(env, {
    id: command.id,
    dispatchMode: DISPATCH_MODE_CLOUD,
    progressStage: "failed",
    actualExecutor: "cloud",
    timeoutPhase: String(commandError?.stage || "").trim().includes("timeout") ? "result-timeout" : "",
    lastDiagnosticCode: commandError?.code || "cloud_execution_failed",
    lastDiagnosticDetail: commandError?.detail || commandError?.message || "Trusted cloud bridge execution failed.",
    errorMessage: normalizedError,
    resultAt: new Date().toISOString()
  });

  await refreshBridgeStatusFromCommands(env, {
    dispatchMode: DISPATCH_MODE_CLOUD,
    executorLabel: getDispatchModeLabel(DISPATCH_MODE_CLOUD),
    bridgeOnline: true,
    lastRunAt: new Date().toISOString(),
    lastError: normalizedError
  });

  return failed.value || command;
}

async function executeTrustedCloudCommand(env, command, runtimeConfig) {
  const dispatchStartedAt = new Date().toISOString();
  const dispatched = await markCommandDispatched(env, {
    id: command.id,
    dispatchMode: DISPATCH_MODE_CLOUD,
    progressStage: "sending",
    dispatchStartedAt,
    dispatchedAt: dispatchStartedAt,
    progressMessage: "Sending request to trusted cloud bridge."
  });
  const inFlight = dispatched.value || command;
  const staged = await upsertCommandDispatchState(env, {
    id: inFlight.id,
    dispatchMode: DISPATCH_MODE_CLOUD,
    status: "dispatched",
    progressStage: "waiting",
    actualExecutor: "cloud",
    progressMessage: "Waiting for trusted cloud bridge to accept the job."
  });

  await refreshBridgeStatusFromCommands(env, {
    dispatchMode: DISPATCH_MODE_CLOUD,
    executorLabel: getDispatchModeLabel(DISPATCH_MODE_CLOUD),
    bridgeOnline: true,
    state: "running",
    lastRunAt: dispatchStartedAt,
    lastDispatchAt: dispatchStartedAt,
    lastError: ""
  });

  const latest = await getCommandById(env, staged.value?.id || inFlight.id) || staged.value || inFlight;

  if (!isCloudDispatchConfigured(runtimeConfig)) {
    return markCloudCommandFailed(env, latest, {
      code: "cloud_bridge_not_configured",
      stage: "cloud-config-missing",
      message: "Trusted cloud bridge is not configured.",
      detail: "Set CLOUD_BRIDGE_BASE_URL and CLOUD_BRIDGE_SHARED_SECRET in the Pages environment."
    });
  }

  const brokered = await submitTrustedCloudCommand(runtimeConfig, latest);

  if (!brokered.ok) {
    return markCloudCommandFailed(env, latest, {
      code: brokered.error?.code || "cloud_bridge_dispatch_failed",
      stage: "cloud-bridge-dispatch-failed",
      message: "Trusted cloud bridge rejected the job.",
      detail: brokered.error?.message || "The trusted cloud bridge did not accept the command."
    });
  }

  const acceptedAt = brokered.acceptedAt || new Date().toISOString();
  const accepted = await upsertCommandDispatchState(env, {
    id: latest.id,
    dispatchMode: DISPATCH_MODE_CLOUD,
    status: "processing",
    progressStage: "waiting",
    actualExecutor: "cloud",
    firstAckAt: acceptedAt,
    firstExecutorAckSeenAt: acceptedAt,
    processingStartedAt: acceptedAt,
    cloudJobId: brokered.jobId,
    progressMessage: brokered.progressMessage || "Trusted cloud bridge accepted the job."
  });

  return accepted.value || latest;
}

export async function dispatchCommandIfNeeded(env, command, runtimeConfig) {
  const config = runtimeConfig || await readRuntimeConfig(env);
  const configuredDispatchMode = getConfiguredDispatchMode(config);
  let dispatchMode = command?.dispatchMode || configuredDispatchMode;
  const dispatchStartedAt = new Date().toISOString();

  if (dispatchMode === DISPATCH_MODE_CLOUD) {
    return {
      ok: true,
      command: await executeTrustedCloudCommand(env, command, config)
    };
  }

  if (dispatchMode !== DISPATCH_MODE_SLACK) {
    const staged = await upsertCommandDispatchState(env, {
      id: command.id,
      dispatchMode,
      status: command.status || "queued",
      progressStage: "dispatching",
      dispatchStartedAt
    });

    await refreshBridgeStatusFromCommands(env, {
      dispatchMode,
      executorLabel: getDispatchModeLabel(dispatchMode),
      bridgeOnline: true,
      lastRunAt: new Date().toISOString()
    });
    return {
      ok: true,
      command: staged.value || command
    };
  }

  try {
    await upsertCommandDispatchState(env, {
      id: command.id,
      dispatchMode,
      status: command.status || "queued",
      progressStage: "dispatching",
      dispatchStartedAt
    });

    const published = await postSlackCommand(config, command, getSlackCodexMention(config));
    const diagnosticsEnabled = isSlackCloudDiagnosticsEnabled(config);
    const publishedAt = new Date().toISOString();
    const dispatched = await markCommandDispatched(env, {
      id: command.id,
      dispatchMode,
      progressStage: "dispatched",
      dispatchStartedAt,
      slackPostedAt: publishedAt,
      slackChannelId: published.channel,
      slackMessageTs: published.ts,
      slackThreadTs: published.threadTs,
      dispatchedAt: publishedAt,
      lastDiagnosticCode: published.photoUpload?.fileId ? "slack_photo_uploaded" : "",
      lastDiagnosticDetail: published.photoUpload?.fileId
        ? `Slack photo upload saved as ${published.photoUpload.fileId}.`
        : "",
      deliveryStopPoint: published.photoUpload?.botCanOpenFile
        ? "slack_file_open_ok"
        : (published.photoUpload?.fileId ? "slack_photo_uploaded" : "slack_root_posted"),
      deliveryEvidence: {
        inspectedAt: publishedAt,
        slackRootPosted: true,
        slackThreadMapped: false,
        slackPhotoUploaded: Boolean(published.photoUpload?.fileId),
        slackFileVisible: String(published.photoUpload?.fileAccess || "").trim().toLowerCase() === "visible",
        slackFileOpenOk: Boolean(published.photoUpload?.botCanOpenFile),
        threadRootSeen: true,
        uploadNoticeSeen: false,
        fileReplySeen: Boolean(published.photoUpload?.fileId),
        fileId: published.photoUpload?.fileId || "",
        fileMode: published.photoUpload?.fileMode || "",
        fileAccess: published.photoUpload?.fileAccess || "",
        botCanOpenFile: typeof published.photoUpload?.botCanOpenFile === "boolean"
          ? published.photoUpload.botCanOpenFile
          : null,
        botOpenHttpStatus: Number(published.photoUpload?.botOpenHttpStatus || 0),
        workerReplySeen: false,
        workerAckSeen: false,
        workerPhotoReadySeen: false,
        executionAckSeen: false,
        photoReadySeen: false,
        ...(diagnosticsEnabled ? {
          matchedChannelId: published.channel,
          matchedThreadTs: published.threadTs,
          slackRootPostedAt: publishedAt,
          ...(published.photoUpload?.fileId ? { slackPhotoUploadedAt: publishedAt } : {}),
          ...(String(published.photoUpload?.fileAccess || "").trim().toLowerCase() === "visible"
            ? { slackFileVisibleAt: publishedAt }
            : {}),
          ...(published.photoUpload?.botCanOpenFile ? { slackFileOpenOkAt: publishedAt } : {})
        } : {})
      },
      photoFileId: published.photoUpload?.fileId,
      photoPermalink: published.photoUpload?.permalink
    });

    await storeSlackThreadCommandMap(env, published.channel, published.threadTs, command.id);
    await storeSlackThreadCommandMap(env, published.channel, published.ts, command.id);
    await storeSlackActiveChannelCommand(env, published.channel, command.id);
    const mappedCommand = await upsertCommandDispatchState(env, {
      id: command.id,
      dispatchMode,
      status: "dispatched",
      progressStage: "dispatched",
      deliveryStopPoint: published.photoUpload?.botCanOpenFile
        ? "slack_file_open_ok"
        : (published.photoUpload?.fileId ? "slack_photo_uploaded" : "slack_thread_mapped"),
      deliveryEvidence: mergeDeliveryEvidence(dispatched.value || command, {
        inspectedAt: new Date().toISOString(),
        slackRootPosted: true,
        slackThreadMapped: true,
        ...(diagnosticsEnabled ? { slackThreadMappedAt: new Date().toISOString() } : {})
      }, config),
      slackChannelId: published.channel,
      slackThreadTs: published.threadTs,
      slackMessageTs: published.ts
    });

    await refreshBridgeStatusFromCommands(env, {
      dispatchMode,
      executorLabel: getDispatchModeLabel(dispatchMode),
      bridgeOnline: true,
      lastRunAt: new Date().toISOString(),
      lastDispatchAt: new Date().toISOString(),
      lastError: ""
    });

    return {
      ok: true,
      command: mappedCommand.value || dispatched.value || command
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Slack dispatch failed.";
    const detail = error && typeof error === "object" && error.commandError
      ? error.commandError
      : {
          code: "slack_dispatch_failed",
          stage: "slack-dispatch-failed",
          message: "Slack dispatch failed. Falling back to local bridge.",
          detail: errorMessage,
          fallback: "local-bridge"
        };
    const fallbackCommand = await fallbackToLocalBridge(
      env,
      command,
      {
        ...detail,
        message: detail.message || "Slack dispatch failed. Falling back to local bridge.",
        detail: detail.detail || errorMessage
      }
    );

    return {
      ok: true,
      command: fallbackCommand
    };
  }
}

async function dispatchCreatedCommand(env, commandId, runtimeConfig) {
  const command = await getCommandById(env, commandId);

  if (!command) {
    return null;
  }

  const status = String(command.status || "").trim().toLowerCase();

  if (status === "answered" || status === "failed" || status === "acked") {
    return command;
  }

  const result = await dispatchCommandIfNeeded(env, command, runtimeConfig);
  return result?.command || command;
}

export async function inspectSlackDispatchProgress(env, runtimeConfig, command) {
  if (!command || command.dispatchMode !== DISPATCH_MODE_SLACK) {
    return {
      command,
      deliveryEvidence: command?.deliveryEvidence || null,
      dispatchObservedAt: 0
    };
  }

  const dispatchObservedAt = String(command.slackChannelId || "").trim() && String(command.slackThreadTs || command.slackMessageTs || "").trim()
    ? Date.parse(String(command.slackPostedAt || command.dispatchedAt || command.createdAt || "").trim()) || Date.now()
    : 0;
  const diagnosticsEnabled = isSlackCloudDiagnosticsEnabled(runtimeConfig);
  let deliveryEvidence = mergeDeliveryEvidence(command, {
    inspectedAt: new Date().toISOString(),
    slackRootPosted: Boolean(String(command.slackMessageTs || "").trim()),
    slackThreadMapped: Boolean(String(command.slackThreadTs || command.slackMessageTs || "").trim()),
    ...(diagnosticsEnabled ? {
      matchedChannelId: String(command.slackChannelId || "").trim(),
      matchedThreadTs: String(command.slackThreadTs || command.slackMessageTs || "").trim()
    } : {})
  }, runtimeConfig);

  if (Boolean(command.photoAttached || command.photo || command.photoBytesPresent)) {
    try {
      const inspected = await inspectSlackPhotoDelivery(env, runtimeConfig, {
        channelId: command.slackChannelId,
        threadTs: command.slackThreadTs || command.slackMessageTs,
        fileId: command.routeAttempts?.at(-1)?.photoFileId
      });
      deliveryEvidence = mergeDeliveryEvidence(command, inspected, runtimeConfig);
    } catch {}
  }

  return {
    command,
    deliveryEvidence,
    dispatchObservedAt
  };
}

export async function finalizeStaleSlackCommands(env, runtimeConfig, commands = []) {
  const candidates = (Array.isArray(commands) ? commands : [])
    .filter((command) => command?.dispatchMode === DISPATCH_MODE_SLACK)
    .filter((command) => {
      const status = String(command?.status || "").trim().toLowerCase();
      return status === "dispatched" || status === "processing";
    })
    .filter((command) => isOlderThan(
      command.progressUpdatedAt || command.replyIngestedAt || command.firstExecutorAckSeenAt || command.dispatchedAt || command.createdAt,
      SLACK_RESULT_WAIT_MS
    ));

  const finalized = [];

  for (const command of candidates) {
    const latest = await getCommandById(env, command.id);

    if (!latest || isFinalCommandStatus(latest.status) || Number(latest.fallbackCount || 0) >= 1) {
      continue;
    }

    const inspected = await inspectSlackDispatchProgress(env, runtimeConfig, latest);
    const timeout = buildSlackDeliveryTimeout(latest, inspected.deliveryEvidence, inspected.dispatchObservedAt);

    if (isCompatCloudPhotoEnabled(latest, runtimeConfig) && canFallbackToLocalBridge(latest)) {
      const fallbackCommand = await fallbackToLocalBridge(env, latest, {
        code: "fallback_to_bridge",
        stage: "switched-to-bridge-compat",
        message: "Cloud photo worker did not confirm startup. Switched to local bridge compat fallback.",
        detail: timeout.lastDiagnosticDetail,
        fallback: "local-bridge",
        mode: "compat",
        cloudInputUnverified: true,
        deliveryStopPoint: timeout.deliveryStopPoint,
        deliveryEvidence: inspected.deliveryEvidence
      });
      finalized.push(fallbackCommand);
      continue;
    }

    const failed = await markCommandFailed(env, {
      id: latest.id,
      progressStage: timeout.progressStage,
      timeoutPhase: "result-timeout",
      lastDiagnosticCode: timeout.lastDiagnosticCode,
      lastDiagnosticDetail: timeout.lastDiagnosticDetail,
      deliveryStopPoint: timeout.deliveryStopPoint,
      deliveryEvidence: inspected.deliveryEvidence,
      errorMessage: timeout.errorMessage
    });

    finalized.push(failed.value || latest);
  }

  return finalized;
}

export async function onRequest(context) {
  const { request, env } = context;
  const preflight = handleOptions(request);

  if (preflight) {
    return preflight;
  }

  try {
  if (request.method === "GET") {
    const url = new URL(request.url);
    const commandId = url.searchParams.get("id");
    const clientId = url.searchParams.get("clientId");
    const status = url.searchParams.get("status");
    const catalog = url.searchParams.get("catalog");
    const scope = url.searchParams.get("scope");
    const includePhotoData = url.searchParams.get("includePhotoData") === "1";
    const allowPhotoData = includePhotoData && Boolean(commandId);

    if (catalog === "threads") {
      if (!isAuthorized(request, env)) {
        return json({ error: "Unauthorized." }, { status: 401 });
      }

      const threads = await listCommandThreads(env);
      return json({ threads });
    }

    if (commandId) {
      const command = await getCommandById(env, commandId);
      return json({ command: serializeCommand(command, { includePhotoData: allowPhotoData }) });
    }

    if (scope === "recent") {
      if (!isAuthorized(request, env)) {
        return json({ error: "Unauthorized." }, { status: 401 });
      }

      const commands = await readCommands(env);
      const filtered = status
        ? commands.filter((command) => command.status === status)
        : commands;

      return json({ commands: serializeCommands(filtered) });
    }

    if (scope === "public") {
      const commands = await readCommands(env);
      const filtered = filterPublicCommands(status
        ? commands.filter((command) => command.status === status)
        : commands);

      return json({ commands: serializeCommands(filtered) });
    }

    if (clientId) {
      const commands = await getCommandsForClient(env, clientId);
      const filtered = filterPublicCommands(status
        ? commands.filter((command) => command.status === status)
        : commands);

      return json({ commands: serializeCommands(filtered) });
    }

    if (!isAuthorized(request, env)) {
      return json({ error: "Unauthorized." }, { status: 401 });
    }

    const commands = await readCommands(env);
    const filtered = status
      ? commands.filter((command) => command.status === status)
      : commands;

    return json({ commands: serializeCommands(filtered) });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, { status: 405 });
  }

  let payload;

  try {
    payload = await request.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const action = String(payload?.action || "create");

  if (action === "ack") {
    if (!isAuthorized(request, env)) {
      return json({ error: "Unauthorized." }, { status: 401 });
    }

    const acked = await acknowledgeCommands(env, payload?.ids);

    if (!acked.ok) {
      return json({ error: acked.error }, { status: 400 });
    }

    return json({ ok: true, commands: acked.value });
  }

    if (action === "answer") {
    if (!isAuthorized(request, env)) {
      return json({ error: "Unauthorized." }, { status: 401 });
    }

    const answered = await markCommandAnswered(env, {
      id: payload?.id,
      progressStage: payload?.progressStage,
      completedAt: payload?.completedAt,
      actualExecutor: payload?.actualExecutor || payload?.actualDispatchMode,
      cloudJobId: payload?.cloudJobId,
      progressMessage: payload?.progressMessage,
      firstAckAt: payload?.firstAckAt,
      firstExecutorAckSeenAt: payload?.firstExecutorAckSeenAt,
      firstReplySeenAt: payload?.firstReplySeenAt,
      replyIngestedAt: payload?.replyIngestedAt,
      resultAt: payload?.resultAt,
      prUrl: payload?.prUrl,
      branchName: payload?.branchName
    });

    if (!answered.ok) {
      return json({ error: answered.error }, { status: 400 });
    }

    return json({ ok: true, command: serializeCommand(answered.value, { includePhotoData: true }) });
  }

  if (action === "fail") {
    if (!isAuthorized(request, env)) {
      return json({ error: "Unauthorized." }, { status: 401 });
    }

    const failed = await markCommandFailed(env, {
      id: payload?.id,
      progressStage: payload?.progressStage,
      completedAt: payload?.completedAt,
      actualExecutor: payload?.actualExecutor || payload?.actualDispatchMode,
      errorMessage: payload?.errorMessage,
      fallbackApplied: payload?.fallbackApplied,
      fallbackCount: payload?.fallbackCount,
      fallbackReason: payload?.fallbackReason,
      cloudJobId: payload?.cloudJobId,
      progressMessage: payload?.progressMessage,
      firstAckAt: payload?.firstAckAt,
      firstExecutorAckSeenAt: payload?.firstExecutorAckSeenAt,
      firstReplySeenAt: payload?.firstReplySeenAt,
      replyIngestedAt: payload?.replyIngestedAt,
      resultAt: payload?.resultAt,
      timeoutPhase: payload?.timeoutPhase,
      lastDiagnosticCode: payload?.lastDiagnosticCode,
      lastDiagnosticDetail: payload?.lastDiagnosticDetail
    });

    if (!failed.ok) {
      return json({ error: failed.error }, { status: 400 });
    }

    return json({ ok: true, command: serializeCommand(failed.value, { includePhotoData: true }) });
  }

  if (action === "claim") {
    if (!isAuthorized(request, env)) {
      return json({ error: "Unauthorized." }, { status: 401 });
    }

    const claimed = await claimNextCommand(env, {
      processorId: payload?.processorId,
      leaseMs: payload?.leaseMs
    });

    if (!claimed.ok) {
      return json({ error: claimed.error }, { status: 400 });
    }

    return json({ ok: true, command: serializeCommand(claimed.value, { includePhotoData: true }) });
  }

  if (action === "progress") {
    if (!isAuthorized(request, env)) {
      return json({ error: "Unauthorized." }, { status: 401 });
    }

    const updated = await updateCommandProgress(env, {
      id: payload?.id,
      progressStage: payload?.progressStage,
      progressUpdatedAt: payload?.progressUpdatedAt,
      processingLeaseUntil: payload?.processingLeaseUntil,
      photoAttached: payload?.photoAttached,
      photoBytesPresent: payload?.photoBytesPresent,
      photoSeenByBridge: payload?.photoSeenByBridge,
      photoProcessed: payload?.photoProcessed,
      photoUnsupportedReason: payload?.photoUnsupportedReason,
      cloudJobId: payload?.cloudJobId,
      progressMessage: payload?.progressMessage,
      lastDiagnosticCode: payload?.lastDiagnosticCode,
      lastDiagnosticDetail: payload?.lastDiagnosticDetail
    });

    if (!updated.ok) {
      return json({ error: updated.error }, { status: 400 });
    }

    return json({ ok: true, command: serializeCommand(updated.value, { includePhotoData: true }) });
  }

  if (action === "requeue") {
    if (!isAuthorized(request, env)) {
      return json({ error: "Unauthorized." }, { status: 401 });
    }

    const requeued = await requeueCommand(env, payload?.id);

    if (!requeued.ok) {
      return json({ error: requeued.error }, { status: 400 });
    }

    return json({ ok: true, command: serializeCommand(requeued.value, { includePhotoData: true }) });
  }

  if (action === "dispatch") {
    if (!isAuthorized(request, env)) {
      return json({ error: "Unauthorized." }, { status: 401 });
    }

    const dispatched = await dispatchCreatedCommand(env, payload?.id, await readRuntimeConfig(env));
    return json({ ok: true, command: serializeCommand(dispatched, { includePhotoData: true }) });
  }

  if (action === "visible") {
    const commandId = String(payload?.id || "").trim();
    const clientId = String(payload?.clientId || "").trim();
    const command = await getCommandById(env, commandId);

    if (!command || !clientId || clientId !== String(command.clientId || "").trim()) {
      return json({ error: "Command not found." }, { status: 404 });
    }

    const updated = await upsertCommandDispatchState(env, {
      id: command.id,
      status: command.status,
      progressStage: command.progressStage,
      uiVisibleAt: payload?.uiVisibleAt || new Date().toISOString()
    });

    return json({ ok: true, command: serializeCommand(updated.value, { includePhotoData: true }) });
  }

  if (action === "replace") {
    if (!isAuthorized(request, env)) {
      return json({ error: "Unauthorized." }, { status: 401 });
    }

    const commands = await writeCommands(env, Array.isArray(payload?.commands) ? payload.commands : []);
    await refreshBridgeStatusFromCommands(env, {
      bridgeOnline: true,
      state: commands.length ? "running" : "idle",
      lastRunAt: new Date().toISOString(),
      lastError: ""
    });
    return json({ ok: true, commands: serializeCommands(commands, { includePhotoData: true }) });
  }

  const runtimeConfig = await readRuntimeConfig(env);
  const requestedDispatchMode = resolveRequestedDispatchMode(payload, runtimeConfig);
  const manifestTarget = resolveProjectDispatchTarget({
    threadId: payload?.threadId,
    projectId: payload?.projectId,
    dispatchMode: requestedDispatchMode,
    projectLabel: payload?.projectLabel,
    projectCategory: payload?.projectCategory,
    targetRepo: payload?.targetRepo,
    targetRepoUrl: payload?.targetRepoUrl,
    targetContextFiles: payload?.targetContextFiles,
    targetWorkspacePath: payload?.targetWorkspacePath
  });

  if (!manifestTarget.ok) {
    return json({ error: manifestTarget.error }, { status: 400 });
  }

  const requestStartedAt = new Date().toISOString();
  const created = await insertCommand(env, {
    ...(payload || {}),
    mode: resolveCommandMode(payload, runtimeConfig),
    dispatchMode: requestedDispatchMode,
    uiSubmitStartedAt: payload?.uiSubmitStartedAt,
    apiCommandsRequestStartedAt: requestStartedAt,
    commandCreatedAt: new Date().toISOString(),
    projectId: manifestTarget.value.id,
    projectLabel: manifestTarget.value.label,
    projectCategory: manifestTarget.value.group,
    targetRepo: manifestTarget.value.targetRepo,
    targetRepoUrl: manifestTarget.value.targetRepoUrl,
    targetContextFiles: manifestTarget.value.contextFiles,
    targetWorkspacePath: manifestTarget.value.workspacePath
  });

  if (!created.ok) {
    return json({ error: created.error }, { status: 400 });
  }

  const command = created.value;
  let dispatched = command;

  try {
    dispatched = await dispatchCreatedCommand(env, command.id, runtimeConfig) || command;
  } catch (error) {
    const latest = await getCommandById(env, command.id).catch(() => null);
    const detail = error instanceof Error ? error.message : String(error || "Unknown dispatch error.");

    if (latest && !isFinalCommandStatus(latest.status)) {
      const failed = await markCommandFailed(env, {
        id: command.id,
        dispatchMode: latest.dispatchMode,
        actualExecutor: latest.actualExecutor || latest.requestedExecutor || latest.dispatchMode,
        progressStage: "failed",
        timeoutPhase: String(latest.timeoutPhase || "").trim(),
        lastDiagnosticCode: "dispatch_failed",
        lastDiagnosticDetail: detail,
        errorMessage: stringifyCommandError({
          code: "dispatch_failed",
          stage: "dispatch-failed",
          message: "Command dispatch failed.",
          detail
        }),
        resultAt: new Date().toISOString()
      }).catch(() => null);

      dispatched = failed?.value || latest;
    } else if (latest) {
      dispatched = latest;
    }
  }

  return json({ ok: true, command: serializeCommand(dispatched) }, { status: 201 });
  } catch (error) {
    return jsonStorageError(error, "Storage is rate limited. Command state is temporarily unavailable.");
  }
}
