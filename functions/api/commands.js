import {
  acknowledgeCommands,
  claimNextCommand,
  COMMAND_TIMEOUTS,
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
  rerouteCommandToSlack,
  runCommandMaintenance,
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
  isSlackDispatchConfigured,
  getSlackCodexMention
} from "../_lib/dispatch.js";
import { isAuthorized } from "../_lib/security.js";
import { classifySlackReply, fetchSlackChannelMessages, fetchSlackThreadReplies, isIgnorableSlackReplyText, isLikelyCodexSlackActor, postSlackCommand } from "../_lib/slack.js";
import { upsertMessages } from "../_lib/messages.js";
import { refreshBridgeStatusFromCommands } from "../_lib/status.js";
import { readRuntimeConfig } from "../_lib/config.js";
import { stringifyCommandError } from "../_lib/command-debug.js";
import { createOpenAiCloudResponse } from "../_lib/openai-cloud.js";
import { resolveProjectDispatchTarget } from "../_lib/project-dispatch-manifest.js";
import {
  buildLatencyBreakdown,
  getVisibleDeliveryStage,
  storeSlackActiveChannelCommand,
  storeSlackThreadCommandMap
} from "../_lib/delivery.js";

const MAX_RECENT_SLACK_SYNC_COMMANDS = 20;
const SLACK_DISPATCH_GRACE_MS = 10_000;
const SLACK_FIRST_ACK_TIMEOUT_MS = 12_000;
const SLACK_RESULT_WAIT_MS = 30_000;
const SLACK_SYNC_POLL_MS = 2_000;
const SLACK_PHOTO_FIRST_ACK_TIMEOUT_MS = 45_000;
const SLACK_PHOTO_RESULT_WAIT_MS = 120_000;

function logCommandError(context, error, extra = {}) {
  const message = error instanceof Error ? error.message : String(error || "Unknown error");
  console.error("[codex-links]", context, {
    ...extra,
    error: message
  });
}

function getSlackFirstAckTimeoutMs(command) {
  return command?.photo ? SLACK_PHOTO_FIRST_ACK_TIMEOUT_MS : SLACK_FIRST_ACK_TIMEOUT_MS;
}

function getSlackResultWaitMs(command) {
  return command?.photo ? SLACK_PHOTO_RESULT_WAIT_MS : SLACK_RESULT_WAIT_MS;
}

function resolveRequestedDispatchMode(payload, runtimeConfig) {
  const hasPhoto = Boolean(payload?.photo && typeof payload.photo === "object");
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

  if (requestedDispatchMode === DISPATCH_MODE_SLACK) {
    return isSlackDispatchConfigured(runtimeConfig) ? DISPATCH_MODE_SLACK : DISPATCH_MODE_LOCAL;
  }

  if (requestedDispatchMode === "direct-openai") {
    if (isCloudDispatchConfigured(runtimeConfig)) {
      return DISPATCH_MODE_CLOUD;
    }

    if (isSlackDispatchConfigured(runtimeConfig)) {
      return DISPATCH_MODE_SLACK;
    }

    return DISPATCH_MODE_LOCAL;
  }

  if (requestedExecutor === "cloud" || requestedDispatchMode === DISPATCH_MODE_CLOUD) {
    if (configuredDispatchMode === DISPATCH_MODE_SLACK && isSlackDispatchConfigured(runtimeConfig)) {
      return DISPATCH_MODE_SLACK;
    }

    if (configuredDispatchMode === DISPATCH_MODE_CLOUD && isCloudDispatchConfigured(runtimeConfig)) {
      return DISPATCH_MODE_CLOUD;
    }

    if (isSlackDispatchConfigured(runtimeConfig)) {
      return DISPATCH_MODE_SLACK;
    }

    if (isCloudDispatchConfigured(runtimeConfig)) {
      return DISPATCH_MODE_CLOUD;
    }

      return DISPATCH_MODE_LOCAL;
  }

  if (hasPhoto && configuredDispatchMode === DISPATCH_MODE_CLOUD) {
    if (isCloudDispatchConfigured(runtimeConfig)) {
      return DISPATCH_MODE_CLOUD;
    }

    return isSlackDispatchConfigured(runtimeConfig) ? DISPATCH_MODE_SLACK : DISPATCH_MODE_LOCAL;
  }

  return configuredDispatchMode;
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

  const photo = command.photo && typeof command.photo === "object"
    ? {
        contentType: String(command.photo.contentType || "").trim(),
        fileName: String(command.photo.fileName || "").trim(),
        size: Number(command.photo.size || 0),
        hasDataUrl: Boolean(String(command.photo.dataUrl || "").trim()),
        ...(options.includePhotoData && String(command.photo.dataUrl || "").trim()
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

function buildUserMessageFromCommand(command) {
  if (!command || typeof command !== "object") {
    return null;
  }

  const text = String(command.text || "").trim() || (command.photo ? "Фото" : "Сообщение без текста");

  return {
    id: `command:${String(command.id || "").trim()}`,
    clientId: String(command.clientId || "").trim(),
    threadId: String(command.threadId || "").trim(),
    threadLabel: String(command.threadLabel || "").trim(),
    commandId: String(command.id || "").trim(),
    role: "user",
    text,
    createdAt: String(command.createdAt || new Date().toISOString()).trim()
  };
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

  const classification = classifySlackReply(latestReply.text);

  await upsertCommandDispatchState(env, {
    id: command.id,
    dispatchMode: DISPATCH_MODE_SLACK,
    status: classification.status,
    progressStage,
    actualExecutor: "cloud",
    slackReplyReceived: true,
    slackReplyThreaded: progressStage !== "slack-reply-received-unthreaded",
    replyMatched: true,
    replyMatchedBy: options.replyMatchedBy || (progressStage === "slack-reply-received-unthreaded" ? "manual-sync" : "thread"),
    firstAckAt: command.firstAckAt || new Date().toISOString(),
    timeoutPhase: "",
    lastDiagnosticCode: progressStage === "slack-reply-received-unthreaded" ? "slack_reply_unthreaded" : "",
    lastDiagnosticDetail: progressStage === "slack-reply-received-unthreaded"
      ? "A Codex reply arrived outside the original Slack thread and was reconciled from recent channel history."
      : "",
    slackChannelId: channelId,
    slackThreadTs: progressStage === "slack-reply-received-unthreaded"
      ? (latestReply.threadTs || latestReply.ts || threadTs)
      : threadTs,
    slackMessageTs: rootTs,
    prUrl: classification.prUrl,
    branchName: classification.branchName,
    errorMessage: classification.status === "failed" ? latestReply.text : "",
    processingStartedAt: classification.status === "processing" ? new Date().toISOString() : "",
    resultAt: classification.status === "answered" || classification.status === "failed" ? new Date().toISOString() : ""
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
    } catch (error) {
      logCommandError("syncRecentSlackReplies", error, { commandId: command?.id || "" });
    }
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
    } catch (error) {
      logCommandError("syncSpecificSlackReplies", error, { commandId: command?.id || "" });
    }
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isBlockedByAnotherLocalBridgeCommand(env, command) {
  const threadId = String(command?.threadId || "").trim();
  const clientId = String(command?.clientId || "").trim();

  if (!threadId || !clientId) {
    return false;
  }

  const commands = await readCommands(env);
  return commands.some((candidate) =>
    candidate?.id !== command?.id
    && candidate?.dispatchMode === DISPATCH_MODE_LOCAL
    && String(candidate?.status || "").trim().toLowerCase() === "processing"
    && String(candidate?.threadId || "").trim() === threadId
    && String(candidate?.clientId || "").trim() === clientId
  );
}

function canFallbackToLocalBridge(command) {
  return Number(command?.fallbackCount || 0) < 1 && (
    (String(command?.threadId || "").trim() && !String(command?.threadId || "").trim().startsWith("cloud:"))
    || String(command?.fallbackThreadId || "").trim()
  );
}

function canFallbackToCloud(command, runtimeConfig) {
  return Number(command?.fallbackCount || 0) < 1
    && Boolean(String(command?.targetRepo || "").trim())
    && isSlackDispatchConfigured(runtimeConfig);
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
    lastDiagnosticDetail: commandError?.detail || commandError?.message || "Direct cloud execution failed.",
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

async function markSlackCloudCommandFailed(env, command, commandError) {
  const normalizedError = stringifyCommandError(commandError);
  const failed = await markCommandFailed(env, {
    id: command.id,
    dispatchMode: DISPATCH_MODE_SLACK,
    progressStage: "failed",
    actualExecutor: "cloud",
    timeoutPhase: String(commandError?.stage || "").trim().includes("timeout") ? "result-timeout" : "",
    lastDiagnosticCode: commandError?.code || "slack_cloud_dispatch_failed",
    lastDiagnosticDetail: commandError?.detail || commandError?.message || "Cloud via Slack failed.",
    errorMessage: normalizedError,
    resultAt: new Date().toISOString()
  });

  await refreshBridgeStatusFromCommands(env, {
    dispatchMode: DISPATCH_MODE_SLACK,
    executorLabel: getDispatchModeLabel(DISPATCH_MODE_SLACK),
    bridgeOnline: true,
    lastRunAt: new Date().toISOString(),
    lastError: normalizedError
  });

  return failed.value || command;
}

async function answerCloudCommand(env, command, result) {
  const nowIso = new Date().toISOString();

  await upsertMessages(env, [{
    id: `cloud:${command.id}:${String(result.responseId || crypto.randomUUID()).trim()}`,
    clientId: command.clientId,
    threadId: command.threadId,
    threadLabel: command.threadLabel,
    commandId: command.id,
    role: "assistant",
    text: result.answerText,
    createdAt: nowIso
  }]);

  const answered = await markCommandAnswered(env, {
    id: command.id,
    dispatchMode: DISPATCH_MODE_CLOUD,
    progressStage: "answered",
    actualExecutor: "cloud",
    firstAckAt: command.firstAckAt || command.dispatchedAt || nowIso,
    firstExecutorAckSeenAt: command.firstExecutorAckSeenAt || nowIso,
    firstReplySeenAt: nowIso,
    replyIngestedAt: nowIso,
    replyMatched: true,
    replyMatchedBy: "direct-api",
    resultAt: nowIso,
    completedAt: nowIso
  });

  await refreshBridgeStatusFromCommands(env, {
    dispatchMode: DISPATCH_MODE_CLOUD,
    executorLabel: getDispatchModeLabel(DISPATCH_MODE_CLOUD),
    bridgeOnline: true,
    state: "idle",
    lastRunAt: nowIso,
    lastSuccessAt: nowIso,
    lastDeliveredCount: 1,
    lastError: ""
  });

  return answered.value || command;
}

async function executeDirectCloudCommand(env, command) {
  const dispatchStartedAt = new Date().toISOString();
  const dispatched = await markCommandDispatched(env, {
    id: command.id,
    dispatchMode: DISPATCH_MODE_CLOUD,
    progressStage: "sent",
    dispatchStartedAt,
    dispatchedAt: dispatchStartedAt
  });
  const inFlight = dispatched.value || command;

  await upsertCommandDispatchState(env, {
    id: inFlight.id,
    dispatchMode: DISPATCH_MODE_CLOUD,
    status: "processing",
    progressStage: "processing",
    actualExecutor: "cloud",
    firstAckAt: dispatchStartedAt,
    firstExecutorAckSeenAt: dispatchStartedAt,
    processingStartedAt: dispatchStartedAt
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

  const latest = await getCommandById(env, inFlight.id) || inFlight;
  const result = await createOpenAiCloudResponse(env, latest);

  if (result.ok) {
    return answerCloudCommand(env, latest, result);
  }

  const runtimeConfig = await readRuntimeConfig(env);

  if (result.retryable && canFallbackToCloud(latest, runtimeConfig)) {
    const rerouted = await rerouteCommandToSlack(env, {
      id: latest.id,
      progressStage: "switched-to-cloud",
      fallbackReason: "direct cloud execution unavailable",
      lastDiagnosticCode: result.commandError?.code || "cloud_execution_failed",
      lastDiagnosticDetail: result.commandError?.detail || result.commandError?.message || "Direct cloud execution failed.",
      errorMessage: stringifyCommandError({
        ...(result.commandError || {}),
        code: "fallback_to_slack",
        stage: "switched-to-cloud-via-slack",
        message: "Direct cloud execution failed. Switched to cloud via Slack.",
        detail: result.commandError?.detail || result.commandError?.message || "Direct cloud execution failed.",
        fallback: "slack-codex-cloud"
      })
    });

    const redispatched = await getCommandById(env, rerouted.value?.id || latest.id);
    if (redispatched) {
      const reroutedResult = await dispatchCommandIfNeeded(env, redispatched, runtimeConfig);
      return reroutedResult?.command || redispatched;
    }
  }

  if (result.retryable && canFallbackToLocalBridge(latest)) {
    const fallbackCommand = await fallbackToLocalBridge(env, latest, {
      ...(result.commandError || {}),
      code: "fallback_to_bridge",
      stage: "switched-to-bridge",
      message: "Direct cloud execution failed. Switched to local bridge.",
      detail: result.commandError?.detail || result.commandError?.message || "Direct cloud execution failed.",
      fallback: "local-bridge"
    });

    const redispatched = await getCommandById(env, fallbackCommand.id);
    if (redispatched) {
      const rerouted = await dispatchCommandIfNeeded(env, redispatched, runtimeConfig);
      return rerouted?.command || redispatched;
    }

    return fallbackCommand;
  }

  return markCloudCommandFailed(env, latest, result.commandError || {
    code: "cloud_execution_failed",
    stage: "cloud-execution-failed",
    message: "Direct cloud execution failed.",
    detail: "The cloud request did not complete successfully."
  });
}

export async function dispatchCommandIfNeeded(env, command, runtimeConfig) {
  const config = runtimeConfig || await readRuntimeConfig(env);
  const dispatchMode = command?.dispatchMode || getConfiguredDispatchMode(config);
  const dispatchStartedAt = new Date().toISOString();

  if (dispatchMode === DISPATCH_MODE_CLOUD) {
    return {
      ok: true,
      command: await executeDirectCloudCommand(env, command)
    };
  }

  if (dispatchMode !== DISPATCH_MODE_SLACK) {
    const staged = await upsertCommandDispatchState(env, {
      id: command.id,
      dispatchMode,
      status: command.status || "queued",
      progressStage: "queued",
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
    const dispatched = await markCommandDispatched(env, {
      id: command.id,
      dispatchMode,
      progressStage: "dispatched",
      dispatchStartedAt,
      slackPostedAt: new Date().toISOString(),
      slackChannelId: published.channel,
      slackMessageTs: published.ts,
      slackThreadTs: published.threadTs,
      dispatchedAt: new Date().toISOString()
    });

    await storeSlackThreadCommandMap(env, published.channel, published.threadTs, command.id);
    await storeSlackThreadCommandMap(env, published.channel, published.ts, command.id);
    await storeSlackActiveChannelCommand(env, published.channel, command.id);

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
      command: dispatched.value || command
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Slack dispatch failed.";
    const detail = error && typeof error === "object" && error.commandError
      ? error.commandError
      : {
          code: "slack_dispatch_failed",
          stage: "slack-dispatch-failed",
          message: "Cloud via Slack dispatch failed.",
          detail: errorMessage,
          fallback: ""
        };

    return {
      ok: true,
      command: await markSlackCloudCommandFailed(env, command, {
        ...detail,
        message: detail.message || "Cloud via Slack dispatch failed.",
        detail: detail.detail || errorMessage,
        fallback: ""
      })
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

async function monitorFirstAckAndFallback(env, commandId, runtimeConfig) {
  let command = await getCommandById(env, commandId);

  if (!command) {
    return null;
  }

  if (command.dispatchMode === DISPATCH_MODE_CLOUD) {
    return command;
  }

  if (command.dispatchMode === DISPATCH_MODE_SLACK) {
    const startedAt = Date.now();
    let dispatchObservedAt = 0;
    const firstAckTimeoutMs = getSlackFirstAckTimeoutMs(command);
    const resultWaitMs = getSlackResultWaitMs(command);

    while ((Date.now() - startedAt) < resultWaitMs) {
      await sleep(SLACK_SYNC_POLL_MS);
      command = await getCommandById(env, commandId);

      if (!command) {
        return null;
      }

      const status = String(command.status || "").trim().toLowerCase();

      if (
        status === "answered"
        || status === "failed"
        || status === "acked"
        || Number(command.fallbackCount || 0) >= 1
      ) {
        return command;
      }

      if (String(command.slackChannelId || "").trim() && String(command.slackThreadTs || command.slackMessageTs || "").trim()) {
        dispatchObservedAt = dispatchObservedAt || Date.now();

        try {
          await syncSpecificSlackReplies(env, runtimeConfig, [command]);
        } catch (error) {
          logCommandError("monitorFirstAckAndFallback.syncSpecificSlackReplies", error, { commandId });
        }

        command = await getCommandById(env, commandId);

        if (!command) {
          return null;
        }

        const syncedStatus = String(command.status || "").trim().toLowerCase();

        if (
          syncedStatus === "answered"
          || syncedStatus === "failed"
          || syncedStatus === "acked"
          || String(command.firstExecutorAckSeenAt || "").trim()
        ) {
          return command;
        }

        if (
          (Date.now() - dispatchObservedAt) >= firstAckTimeoutMs
          && canFallbackToLocalBridge(command)
        ) {
          const fallbackCommand = await fallbackToLocalBridge(env, command, {
            code: "fallback_to_bridge",
            stage: "fallback-to-bridge",
            message: "Cloud via Slack did not acknowledge in time. Switched to local bridge.",
            detail: "Slack dispatch succeeded, but no Codex acknowledgement was observed within the Slack first-ack window.",
            fallback: "local-bridge"
          });

          const redispatched = await getCommandById(env, fallbackCommand.id);
          if (redispatched) {
            const rerouted = await dispatchCommandIfNeeded(env, redispatched, runtimeConfig);
            return rerouted?.command || redispatched;
          }

          return fallbackCommand;
        }

        continue;
      }

      if ((Date.now() - startedAt) < SLACK_DISPATCH_GRACE_MS) {
        continue;
      }

      if (canFallbackToLocalBridge(command)) {
        const fallbackCommand = await fallbackToLocalBridge(env, command, {
          code: "fallback_to_bridge",
          stage: "fallback-to-bridge",
          message: "Cloud via Slack did not create a dispatch thread in time. Switched to local bridge.",
          detail: "No Slack dispatch thread or Codex acknowledgement was observed within the Slack dispatch grace window.",
          fallback: "local-bridge"
        });

        const redispatched = await getCommandById(env, fallbackCommand.id);
        if (redispatched) {
          const rerouted = await dispatchCommandIfNeeded(env, redispatched, runtimeConfig);
          return rerouted?.command || redispatched;
        }

        return fallbackCommand;
      }

      break;
    }

    command = await getCommandById(env, commandId);

    if (!command) {
      return null;
    }

    const status = String(command.status || "").trim().toLowerCase();

    if (
      status === "answered"
      || status === "failed"
      || status === "acked"
      || String(command.firstExecutorAckSeenAt || "").trim()
      || Number(command.fallbackCount || 0) >= 1
    ) {
      return command;
    }

    if (canFallbackToLocalBridge(command)) {
      const fallbackCommand = await fallbackToLocalBridge(env, command, {
        code: "fallback_to_bridge",
        stage: "fallback-to-bridge",
        message: "Cloud via Slack did not produce a reply in time. Switched to local bridge.",
        detail: dispatchObservedAt
          ? "Slack dispatch succeeded, but no Codex reply was observed within the Slack result wait window."
          : "No Slack dispatch thread or Codex reply was observed within the Slack result wait window.",
        fallback: "local-bridge"
      });

      const redispatched = await getCommandById(env, fallbackCommand.id);
      if (redispatched) {
        const rerouted = await dispatchCommandIfNeeded(env, redispatched, runtimeConfig);
        return rerouted?.command || redispatched;
      }

      return fallbackCommand;
    }

    const failed = await markCommandFailed(env, {
      id: command.id,
      progressStage: "failed",
      timeoutPhase: "result-timeout",
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
    });

    return failed.value || command;
  }

  const waitMs = COMMAND_TIMEOUTS.bridgeClaimMs;
  await sleep(waitMs);
  command = await getCommandById(env, commandId);

  if (!command) {
    return null;
  }

  const status = String(command.status || "").trim().toLowerCase();

  if (
    status === "answered"
    || status === "failed"
    || status === "acked"
    || String(command.firstExecutorAckSeenAt || "").trim()
    || Number(command.fallbackCount || 0) >= 1
  ) {
    return command;
  }

  if (await isBlockedByAnotherLocalBridgeCommand(env, command)) {
    return command;
  }

  if (canFallbackToCloud(command, runtimeConfig)) {
    const rerouted = await rerouteCommandToSlack(env, {
      id: command.id,
      progressStage: "switched-to-cloud",
      timeoutPhase: "claim-timeout",
      fallbackReason: "local bridge did not claim the command in time",
      lastDiagnosticCode: "bridge_claim_timeout",
      lastDiagnosticDetail: "The local bridge did not claim the command before the claim timeout.",
      errorMessage: stringifyCommandError({
        code: "fallback_to_slack",
        stage: "switched-to-cloud",
        message: "Local bridge did not claim the command in time. Switched to cloud via Slack.",
        detail: "The local bridge did not claim the command before the claim timeout.",
        fallback: "slack-codex-cloud"
      })
    });

    if (rerouted.ok && rerouted.value) {
      return dispatchCreatedCommand(env, rerouted.value.id, runtimeConfig);
    }
  }

  const failed = await markCommandFailed(env, {
    id: command.id,
    progressStage: "failed",
    actualExecutor: "bridge",
    timeoutPhase: "claim-timeout",
    lastDiagnosticCode: "bridge_claim_timeout",
    lastDiagnosticDetail: "The local bridge did not claim the command before the claim timeout.",
    errorMessage: stringifyCommandError({
      code: "bridge_claim_timeout",
      stage: "bridge-claim-timeout",
      message: "Local bridge did not claim the command in time.",
      detail: "The local bridge did not claim the command before the claim timeout."
    })
  });

  return failed.value || command;
}

async function reconcileCommandsForRead(env, runtimeConfig) {
  try {
    await syncRecentSlackReplies(env, runtimeConfig);
  } catch (error) {
    logCommandError("reconcileCommandsForRead.syncRecentSlackReplies", error);
  }

  let maintenance = null;
  try {
    maintenance = await runCommandMaintenance(env, {
      preferSlack: isSlackDispatchConfigured(runtimeConfig),
      fallbackToLocal: true
    });
  } catch (error) {
    logCommandError("reconcileCommandsForRead.runCommandMaintenance", error);
    return;
  }

  for (const commandId of maintenance?.commandsToDispatch || []) {
    try {
      const command = await getCommandById(env, commandId);
      if (command) {
        await dispatchCommandIfNeeded(env, command, runtimeConfig);
      }
    } catch (error) {
      logCommandError("reconcileCommandsForRead.dispatchCommandIfNeeded", error, { commandId });
    }
  }
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
    const runtimeConfig = await readRuntimeConfig(env);

    if (catalog === "threads") {
      if (!isAuthorized(request, env)) {
        return json({ error: "Unauthorized." }, { status: 401 });
      }

      const threads = await listCommandThreads(env);
      return json({ threads });
    }

    if (commandId) {
      await reconcileCommandsForRead(env, runtimeConfig);
      const command = await getCommandById(env, commandId);
      return json({ command: serializeCommand(command) });
    }

    if (scope === "recent") {
      if (!isAuthorized(request, env)) {
        return json({ error: "Unauthorized." }, { status: 401 });
      }

      await reconcileCommandsForRead(env, runtimeConfig);
      const commands = await readCommands(env);
      const filtered = status
        ? commands.filter((command) => command.status === status)
        : commands;

      return json({ commands: serializeCommands(filtered, { includePhotoData: true }) });
    }

    if (scope === "public") {
      await reconcileCommandsForRead(env, runtimeConfig);
      const commands = await readCommands(env);
      const filtered = filterPublicCommands(status
        ? commands.filter((command) => command.status === status)
        : commands);

      return json({ commands: serializeCommands(filtered) });
    }

    if (clientId) {
      await reconcileCommandsForRead(env, runtimeConfig);
      const commands = await getCommandsForClient(env, clientId);
      const filtered = filterPublicCommands(status
        ? commands.filter((command) => command.status === status)
        : commands);

      return json({ commands: serializeCommands(filtered) });
    }

    if (!isAuthorized(request, env)) {
      return json({ error: "Unauthorized." }, { status: 401 });
    }

    await reconcileCommandsForRead(env, runtimeConfig);
    const commands = await readCommands(env);
    const filtered = status
      ? commands.filter((command) => command.status === status)
      : commands;

    return json({ commands: serializeCommands(filtered, { includePhotoData: true }) });
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

    let claimDiagnostics = null;

    if (!claimed.value) {
      const snapshot = await readCommands(env);
      const queuedLocal = snapshot.filter((command) =>
        command.dispatchMode === DISPATCH_MODE_LOCAL && command.status === "queued"
      );
      const processingLocal = snapshot.filter((command) =>
        command.dispatchMode === DISPATCH_MODE_LOCAL && command.status === "processing"
      );

      claimDiagnostics = {
        queuedLocalCount: queuedLocal.length,
        processingLocalCount: processingLocal.length,
        queuedLocalIds: queuedLocal.slice(0, 5).map((command) => command.id),
        processingLocalIds: processingLocal.slice(0, 5).map((command) => command.id)
      };

      if (queuedLocal.length || processingLocal.length) {
        console.error("[codex-links] claim returned null", claimDiagnostics);
      }
    }

    return json({
      ok: true,
      command: serializeCommand(claimed.value, { includePhotoData: true }),
      claimDiagnostics
    });
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
  await upsertMessages(env, [buildUserMessageFromCommand(command)]);

  context.waitUntil((async () => {
    try {
      await dispatchCreatedCommand(env, command.id, runtimeConfig);
      await monitorFirstAckAndFallback(env, command.id, runtimeConfig);
    } catch (error) {
      logCommandError("createCommand.waitUntil", error, { commandId: command.id });
    }
  })());

  return json({ ok: true, command: serializeCommand(command) }, { status: 201 });
  } catch (error) {
    return jsonStorageError(error, "Storage is rate limited. Command state is temporarily unavailable.");
  }
}
