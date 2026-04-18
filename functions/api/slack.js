import { getCommandBySlackThread, readCommands, upsertCommandDispatchState } from "../_lib/commands.js";
import { handleOptions, json } from "../_lib/http.js";
import { upsertMessages } from "../_lib/messages.js";
import { DISPATCH_MODE_SLACK, getDispatchModeLabel } from "../_lib/dispatch.js";
import {
  classifySlackReply,
  extractSlackMessageText,
  isIgnorableSlackReplyText,
  isLikelyCodexSlackActor,
  isSlackMessageEvent,
  verifySlackRequestSignature
} from "../_lib/slack.js";
import { refreshBridgeStatusFromCommands } from "../_lib/status.js";
import { readRuntimeConfig } from "../_lib/config.js";
import { stringifyCommandError } from "../_lib/command-debug.js";

const RECENT_COMMAND_WINDOW_MS = 30 * 60 * 1000;

function shouldTrackSlackEvent(event) {
  const channel = String(event?.channel || "").trim();
  const threadTs = String(event?.thread_ts || "").trim();
  const ts = String(event?.ts || "").trim();

  if (!channel) {
    return false;
  }

  if (!threadTs || threadTs === ts) {
    return false;
  }

  if (event?.subtype === "message_changed" || event?.subtype === "message_deleted") {
    return false;
  }

  return true;
}

function getSlackEventTimestamp(event) {
  const raw = String(event?.event_ts || event?.ts || "").trim();
  const value = Number(raw);

  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return value * 1000;
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
    firstAckAt: String(command.firstAckAt || "").trim()
  });
}

async function findLikelyUnthreadedSlackCommand(env, runtimeConfig, event) {
  const channelId = String(event?.channel || "").trim();
  const eventTimestamp = getSlackEventTimestamp(event) || Date.now();

  const commands = await readCommands(env);
  const candidates = commands.filter((command) => {
    const status = String(command?.status || "").trim().toLowerCase();
    const createdAt = Date.parse(String(command?.createdAt || "").trim());
    const dispatchedAt = Date.parse(String(command?.dispatchedAt || command?.createdAt || "").trim());

    return command.dispatchMode === DISPATCH_MODE_SLACK
      && command.slackChannelId === channelId
      && (status === "dispatched" || status === "processing")
      && !command.replyMatched
      && !Number.isNaN(createdAt)
      && !Number.isNaN(dispatchedAt)
      && createdAt <= eventTimestamp
      && dispatchedAt <= eventTimestamp
      && (eventTimestamp - createdAt) <= RECENT_COMMAND_WINDOW_MS;
  });

  if (!candidates.length) {
    return null;
  }

  if (!isLikelyCodexSlackActor(runtimeConfig, event, { candidateCount: candidates.length })) {
    return null;
  }

  const command = [...candidates].sort((left, right) =>
    Date.parse(String(left?.dispatchedAt || left?.createdAt || "").trim())
      - Date.parse(String(right?.dispatchedAt || right?.createdAt || "").trim())
    || Date.parse(String(left?.createdAt || "").trim()) - Date.parse(String(right?.createdAt || "").trim())
  )[0];

  return { command };
}

async function findLikelyThreadedSlackCommand(env, runtimeConfig, event) {
  const channelId = String(event?.channel || "").trim();
  const eventTimestamp = getSlackEventTimestamp(event) || Date.now();

  if (!channelId) {
    return null;
  }

  const commands = await readCommands(env);
  const candidates = commands.filter((command) => {
    const status = String(command?.status || "").trim().toLowerCase();
    const createdAt = Date.parse(String(command?.createdAt || "").trim());

    return command.dispatchMode === DISPATCH_MODE_SLACK
      && command.slackChannelId === channelId
      && (status === "dispatched" || status === "processing")
      && !command.replyMatched
      && !Number.isNaN(createdAt)
      && createdAt <= eventTimestamp
      && (eventTimestamp - createdAt) <= RECENT_COMMAND_WINDOW_MS;
  });

  if (!candidates.length) {
    return null;
  }

  if (!isLikelyCodexSlackActor(runtimeConfig, event, { candidateCount: candidates.length })) {
    return null;
  }

  return [...candidates].sort((left, right) =>
    Date.parse(String(left?.dispatchedAt || left?.createdAt || "").trim())
      - Date.parse(String(right?.dispatchedAt || right?.createdAt || "").trim())
  )[0] || null;
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

  const classification = classifySlackReply(text);
  const progressStage = options.progressStage || "slack-reply-received";

  const nextState = await upsertCommandDispatchState(env, {
    id: command.id,
    dispatchMode: DISPATCH_MODE_SLACK,
    status: classification.status,
    progressStage,
    actualExecutor: "cloud",
    slackReplyReceived: true,
    slackReplyThreaded: progressStage !== "slack-reply-received-unthreaded",
    replyMatched: true,
    replyMatchedBy: progressStage === "slack-reply-received-unthreaded" ? "unthreaded-fallback" : "thread",
    firstAckAt: command.firstAckAt || new Date().toISOString(),
    timeoutPhase: "",
    lastDiagnosticCode: progressStage === "slack-reply-received-unthreaded" ? "slack_reply_unthreaded" : "",
    lastDiagnosticDetail: progressStage === "slack-reply-received-unthreaded"
      ? "A Codex reply arrived outside the original Slack thread and was reconciled back to the command."
      : "",
    slackChannelId: channelId,
    slackThreadTs: effectiveThreadTs,
    slackMessageTs: command.slackMessageTs,
    prUrl: classification.prUrl,
    branchName: classification.branchName,
    errorMessage: classification.status === "failed" ? text : "",
    processingStartedAt: classification.status === "processing" ? new Date().toISOString() : "",
    resultAt: classification.status === "answered" || classification.status === "failed" ? new Date().toISOString() : ""
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
      createdAt: new Date(Number(String(event.event_ts || event.ts || "0")) * 1000 || Date.now()).toISOString()
    }]);
  }

  await refreshBridgeStatusFromCommands(env, {
    dispatchMode: DISPATCH_MODE_SLACK,
    executorLabel: getDispatchModeLabel(DISPATCH_MODE_SLACK),
    bridgeOnline: true,
    state: classification.status === "processing" ? "running" : "idle",
    lastRunAt: new Date().toISOString(),
    lastSuccessAt: classification.status === "answered" ? new Date().toISOString() : undefined,
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
        const threadTs = String(event.thread_ts || "").trim();
        const channelId = String(event.channel || "").trim();

        if (threadTs && channelId) {
          const command = await getCommandBySlackThread(env, channelId, threadTs);

          if (command) {
            await markSlackCommandDiagnostic(env, command, {
              progressStage: "slack-signature-failed",
              status: "failed",
              channelId,
              threadTs,
              slackReplyReceived: true,
              slackReplyThreaded: true,
              slackReplyMatched: true,
              error: {
                code: "slack_signature_failed",
                stage: "slack-signature-failed",
                message: "Slack signature validation failed.",
                detail: "Slack webhook request was rejected with HTTP 401 before reply ingestion."
              },
              code: "slack_webhook_unauthorized",
              detail: "Slack webhook request was rejected with HTTP 401 before reply ingestion."
            });
          }
        } else {
          const likely = await findLikelyUnthreadedSlackCommand(env, runtimeConfig, event);

          if (likely?.command) {
            await markSlackCommandDiagnostic(env, likely.command, {
              progressStage: "slack-signature-failed",
              status: likely.command.status || "processing",
              channelId,
              threadTs,
              slackReplyReceived: true,
              slackReplyThreaded: false,
              slackReplyMatched: false,
              code: "slack_webhook_unauthorized",
              detail: "Slack webhook request for an unthreaded reply was rejected before reconciliation."
            });
          }
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
    const likely = await findLikelyUnthreadedSlackCommand(env, runtimeConfig, event);

    if (likely) {
      const result = await ingestSlackReply(env, likely.command, event, {
        progressStage: "slack-reply-received-unthreaded"
      });

      return json({
        ok: true,
        matchedVia: "unthreaded-fallback",
        command: result.command
      });
    }

    return json({ ok: true });
  }

  const threadTs = String(event.thread_ts || "").trim();
  const channelId = String(event.channel || "").trim();
  const command = await getCommandBySlackThread(env, channelId, threadTs);

  if (!command) {
    const likely = await findLikelyThreadedSlackCommand(env, runtimeConfig, event);

    if (likely) {
      await markSlackCommandDiagnostic(env, likely, {
        progressStage: "slack-reply-unmatched",
        status: likely.status || "processing",
        channelId,
        threadTs,
        slackReplyReceived: true,
        slackReplyThreaded: true,
        slackReplyMatched: false,
        code: "slack_reply_unmatched",
        detail: "A Codex Slack reply arrived in a thread, but it did not match the stored thread identifiers for the command."
      });
    }

    return json({ ok: true });
  }

  const result = await ingestSlackReply(env, command, event, {
    progressStage: "slack-reply-received"
  });

  return json({
    ok: true,
    command: result.command
  });
}
