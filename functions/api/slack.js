import { getCommandBySlackThread, upsertCommandDispatchState } from "../_lib/commands.js";
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

  const threadTs = String(event.thread_ts || "").trim();
  const channelId = String(event.channel || "").trim();
  const command = await getCommandBySlackThread(env, channelId, threadTs);

  if (!command) {
    return json({ ok: true });
  }

  const text = extractSlackMessageText(event);
  const classification = classifySlackReply(text);
  const nextState = await upsertCommandDispatchState(env, {
    id: command.id,
    dispatchMode: DISPATCH_MODE_SLACK,
    status: classification.status,
    progressStage: classification.progressStage,
    slackChannelId: channelId,
    slackThreadTs: threadTs,
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

  return json({
    ok: true,
    command: nextState.value || command
  });
}
