import { getCommandBySlackThread, readCommands, upsertCommandDispatchState } from "../_lib/commands.js";
import { handleOptions, json } from "../_lib/http.js";
import { upsertMessages } from "../_lib/messages.js";
import { DISPATCH_MODE_SLACK, getDispatchModeLabel } from "../_lib/dispatch.js";
import {
  classifySlackReply,
  extractSlackMessageText,
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
    slackChannelId: String(input.channelId || command.slackChannelId || "").trim(),
    slackThreadTs: String(input.threadTs || command.slackThreadTs || command.slackMessageTs || "").trim(),
    slackMessageTs: String(command.slackMessageTs || "").trim(),
    errorMessage: stringifyCommandError(input.error || {}),
    processingStartedAt: String(command.processingStartedAt || "").trim()
  });
}

async function findLikelyUnthreadedSlackCommand(env, runtimeConfig, event) {
  const targetUserId = String(runtimeConfig?.SLACK_CODEX_USER_ID || "").trim();
  const channelId = String(event?.channel || "").trim();
  const eventTimestamp = getSlackEventTimestamp(event) || Date.now();

  if (!targetUserId || !channelId || String(event?.user || "").trim() !== targetUserId) {
    return null;
  }

  const commands = await readCommands(env);
  const candidates = commands.filter((command) => {
    const status = String(command?.status || "").trim().toLowerCase();
    const createdAt = Date.parse(String(command?.createdAt || "").trim());
    const dispatchedAt = Date.parse(String(command?.dispatchedAt || command?.createdAt || "").trim());

    return command.dispatchMode === DISPATCH_MODE_SLACK
      && command.slackChannelId === channelId
      && (status === "dispatched" || status === "processing")
      && !Number.isNaN(createdAt)
      && !Number.isNaN(dispatchedAt)
      && createdAt <= eventTimestamp
      && dispatchedAt <= eventTimestamp
      && (eventTimestamp - createdAt) <= RECENT_COMMAND_WINDOW_MS;
  });

  if (!candidates.length) {
    return null;
  }

  const command = [...candidates].sort((left, right) =>
    Date.parse(String(right?.dispatchedAt || right?.createdAt || "").trim())
      - Date.parse(String(left?.dispatchedAt || left?.createdAt || "").trim())
    || Date.parse(String(right?.createdAt || "").trim()) - Date.parse(String(left?.createdAt || "").trim())
  )[0];

  return { command, targetUserId };
}

async function ingestSlackReply(env, command, event, options = {}) {
  if (!command?.id) {
    return { ok: false, command: null };
  }

  const channelId = String(event?.channel || "").trim();
  const replyThreadTs = String(event?.thread_ts || "").trim();
  const effectiveThreadTs = replyThreadTs || String(command.slackThreadTs || command.slackMessageTs || "").trim();
  const text = extractSlackMessageText(event);
  const classification = classifySlackReply(text);
  const progressStage = options.progressStage || "slack-reply-received";

  const nextState = await upsertCommandDispatchState(env, {
    id: command.id,
    dispatchMode: DISPATCH_MODE_SLACK,
    status: classification.status,
    progressStage,
    slackChannelId: channelId,
    slackThreadTs: effectiveThreadTs,
    slackMessageTs: command.slackMessageTs,
    prUrl: classification.prUrl,
    branchName: classification.branchName,
    errorMessage: classification.status === "failed" ? text : "",
    processingStartedAt: classification.status === "processing" ? new Date().toISOString() : ""
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
              error: {
                code: "slack_signature_failed",
                stage: "slack-signature-failed",
                message: "Slack signature validation failed.",
                detail: "Slack webhook request was rejected with HTTP 401 before reply ingestion."
              }
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
