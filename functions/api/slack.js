import { getCommandById, upsertCommandDispatchState } from "../_lib/commands.js";
import { handleOptions, json } from "../_lib/http.js";
import { upsertMessages } from "../_lib/messages.js";
import { DISPATCH_MODE_SLACK, getDispatchModeLabel } from "../_lib/dispatch.js";
import {
  deriveSlackReplyOutcome,
  extractSlackMessageText,
  isIgnorableSlackReplyText,
  isLikelyCodexSlackActor,
  isSlackMessageEvent,
  verifySlackRequestSignature
} from "../_lib/slack.js";
import { refreshBridgeStatusFromCommands } from "../_lib/status.js";
import { readRuntimeConfig } from "../_lib/config.js";
import { stringifyCommandError } from "../_lib/command-debug.js";
import {
  clearSlackActiveChannelCommand,
  getSlackActiveChannelCommandId,
  getSlackThreadCommandId
} from "../_lib/delivery.js";

function shouldTrackSlackEvent(event) {
  const channel = String(event?.channel || "").trim();
  const subtype = String(event?.subtype || "").trim();

  if (!channel) {
    return false;
  }

  if (subtype === "message_changed" || subtype === "message_deleted") {
    return false;
  }

  return true;
}

async function markSlackCommandDiagnostic(env, command, input = {}) {
  if (!command?.id) {
    return null;
  }

  return upsertCommandDispatchState(env, {
    id: command.id,
    dispatchMode: DISPATCH_MODE_SLACK,
    status: input.status || command.status || "processing",
    progressStage: input.progressStage,
    slackReplyReceived: typeof input.slackReplyReceived === "boolean" ? input.slackReplyReceived : command.slackReplyReceived,
    slackReplyThreaded: typeof input.slackReplyThreaded === "boolean" ? input.slackReplyThreaded : command.slackReplyThreaded,
    replyMatched: typeof input.replyMatched === "boolean"
      ? input.replyMatched
      : (typeof input.slackReplyMatched === "boolean" ? input.slackReplyMatched : command.replyMatched),
    replyMatchedBy: input.replyMatchedBy || command.replyMatchedBy,
    timeoutPhase: input.timeoutPhase,
    fallbackApplied: typeof input.fallbackApplied === "boolean" ? input.fallbackApplied : command.fallbackApplied,
    fallbackReason: input.fallbackReason,
    lastDiagnosticCode: input.code,
    lastDiagnosticDetail: input.detail,
    slackChannelId: String(input.channelId || command.slackChannelId || "").trim(),
    slackThreadTs: String(input.threadTs || command.slackThreadTs || command.slackMessageTs || "").trim(),
    slackMessageTs: String(command.slackMessageTs || "").trim(),
    errorMessage: stringifyCommandError(input.error || {}),
    processingStartedAt: String(command.processingStartedAt || "").trim(),
    firstAckAt: String(command.firstAckAt || "").trim(),
    firstExecutorAckSeenAt: String(command.firstExecutorAckSeenAt || "").trim(),
    firstReplySeenAt: String(command.firstReplySeenAt || "").trim(),
    replyIngestedAt: String(command.replyIngestedAt || "").trim()
  });
}

async function resolveSlackCommand(env, runtimeConfig, event) {
  const channelId = String(event?.channel || "").trim();
  const threadTs = String(event?.thread_ts || "").trim();

  if (!channelId) {
    return { command: null, matchedVia: "" };
  }

  if (threadTs) {
    const exactCommandId = await getSlackThreadCommandId(env, channelId, threadTs);

    if (exactCommandId) {
      const exactCommand = await getCommandById(env, exactCommandId);

      if (exactCommand && isLikelyCodexSlackActor(runtimeConfig, event, { candidateCount: 1 })) {
        return {
          command: exactCommand,
          matchedVia: "thread-map"
        };
      }
    }
  }

  const activeCommandId = await getSlackActiveChannelCommandId(env, channelId);

  if (!activeCommandId) {
    return { command: null, matchedVia: "" };
  }

  const activeCommand = await getCommandById(env, activeCommandId);
  const activeStatus = String(activeCommand?.status || "").trim().toLowerCase();

  if (
    !activeCommand
    || activeCommand.dispatchMode !== DISPATCH_MODE_SLACK
    || !["dispatched", "processing"].includes(activeStatus)
    || !isLikelyCodexSlackActor(runtimeConfig, event, { candidateCount: 1 })
  ) {
    return { command: null, matchedVia: "" };
  }

  return {
    command: activeCommand,
    matchedVia: "active-channel"
  };
}

async function ingestSlackReply(env, command, event, options = {}) {
  if (!command?.id) {
    return { ok: false, command: null };
  }

  const channelId = String(event?.channel || "").trim();
  const replyThreadTs = String(event?.thread_ts || "").trim();
  const effectiveThreadTs = replyThreadTs || String(command.slackThreadTs || command.slackMessageTs || "").trim();
  const text = extractSlackMessageText(event);

  if (isIgnorableSlackReplyText(text)) {
    return {
      ok: true,
      command,
      classification: {
        status: String(command.status || "").trim().toLowerCase() || "processing",
        progressStage: String(command.progressStage || "").trim() || "processing"
      }
    };
  }

  const classification = deriveSlackReplyOutcome(command, text);
  const eventIso = new Date(Number(String(event.event_ts || event.ts || "0")) * 1000 || Date.now()).toISOString();
  const replyIngestedAt = new Date().toISOString();
  const isFirstAck = classification.executionAckValid && !String(command.firstExecutorAckSeenAt || "").trim();
  const isFirstReply = Boolean(text) && !String(command.firstReplySeenAt || "").trim();
  const progressStage = options.progressStage
    || (isFirstAck && classification.status === "processing" ? "accepted" : classification.progressStage || "processing");

  const nextState = await upsertCommandDispatchState(env, {
    id: command.id,
    dispatchMode: DISPATCH_MODE_SLACK,
    status: classification.status,
    progressStage,
    actualExecutor: "cloud",
    slackReplyReceived: true,
    slackReplyThreaded: Boolean(replyThreadTs),
    replyMatched: true,
    replyMatchedBy: options.replyMatchedBy || (replyThreadTs ? "thread" : "unthreaded-fallback"),
    firstAckAt: classification.executionAckValid ? (command.firstAckAt || eventIso) : command.firstAckAt,
    firstExecutorAckSeenAt: classification.executionAckValid ? (command.firstExecutorAckSeenAt || eventIso) : command.firstExecutorAckSeenAt,
    firstReplySeenAt: isFirstReply ? eventIso : command.firstReplySeenAt,
    replyIngestedAt,
    timeoutPhase: "",
    lastDiagnosticCode: classification.lastDiagnosticCode || (!replyThreadTs ? "slack_reply_unthreaded" : ""),
    lastDiagnosticDetail: classification.lastDiagnosticDetail || (!replyThreadTs
      ? "A Codex reply arrived outside the original Slack thread and was reconciled using the active channel mapping."
      : ""),
    slackChannelId: channelId,
    slackThreadTs: effectiveThreadTs,
    slackMessageTs: command.slackMessageTs,
    prUrl: classification.prUrl,
    branchName: classification.branchName,
    errorMessage: classification.status === "failed" ? text : "",
    processingStartedAt: classification.status === "processing" ? (command.processingStartedAt || replyIngestedAt) : "",
    resultAt: classification.status === "answered" || classification.status === "failed" ? replyIngestedAt : ""
  });

  if (text) {
    await upsertMessages(env, [{
      id: `slack:${channelId}:${String(event.ts || "").trim()}`,
      clientId: command.clientId,
      threadId: command.threadId,
      threadLabel: command.threadLabel,
      commandId: command.id,
      role: "assistant",
      text,
      createdAt: eventIso
    }]);
  }

  if (classification.status === "answered" || classification.status === "failed") {
    await clearSlackActiveChannelCommand(env, channelId, command.id);
  }

  await refreshBridgeStatusFromCommands(env, {
    dispatchMode: DISPATCH_MODE_SLACK,
    executorLabel: getDispatchModeLabel(DISPATCH_MODE_SLACK),
    bridgeOnline: true,
    state: classification.status === "processing" ? "running" : "idle",
    lastRunAt: replyIngestedAt,
    lastSuccessAt: classification.status === "answered" ? replyIngestedAt : undefined,
    lastDeliveredCount: classification.status === "answered" ? 1 : 0,
    lastError: classification.status === "failed" ? text : ""
  });

  return {
    ok: true,
    command: nextState.value || command,
    classification
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const preflight = handleOptions(request);

  if (preflight) {
    return preflight;
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, { status: 405 });
  }

  const rawBody = await request.text();
  const runtimeConfig = await readRuntimeConfig(env);
  const verified = await verifySlackRequestSignature(request, rawBody, runtimeConfig);

  if (!verified) {
    try {
      const payload = JSON.parse(rawBody);

      if (isSlackMessageEvent(payload)) {
        const event = payload.event || {};
        const resolved = await resolveSlackCommand(env, runtimeConfig, event);

        if (resolved?.command) {
          await markSlackCommandDiagnostic(env, resolved.command, {
            progressStage: "slack-signature-failed",
            status: resolved.command.status || "processing",
            channelId: String(event.channel || "").trim(),
            threadTs: String(event.thread_ts || "").trim(),
            slackReplyReceived: true,
            slackReplyThreaded: Boolean(String(event.thread_ts || "").trim()),
            slackReplyMatched: resolved.matchedVia === "thread-map",
            code: "slack_webhook_unauthorized",
            detail: "Slack webhook request was rejected with HTTP 401 before reply ingestion."
          });
        }
      }
    } catch {}

    return json({ error: "Unauthorized." }, { status: 401 });
  }

  let payload;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (payload?.type === "url_verification") {
    return json({ challenge: payload?.challenge || "" });
  }

  if (!isSlackMessageEvent(payload)) {
    return json({ ok: true });
  }

  const event = payload.event;

  if (!shouldTrackSlackEvent(event)) {
    return json({ ok: true });
  }

  const resolved = await resolveSlackCommand(env, runtimeConfig, event);

  if (!resolved?.command) {
    return json({ ok: true, matchedVia: "none" });
  }

  const result = await ingestSlackReply(env, resolved.command, event, {
    replyMatchedBy: resolved.matchedVia === "active-channel" ? "unthreaded-fallback" : "thread"
  });

  return json({
    ok: true,
    matchedVia: resolved.matchedVia,
    command: result.command
  });
}
