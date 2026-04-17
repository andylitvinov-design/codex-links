import { handleOptions, json } from "../_lib/http.js";
import { readCommands, recoverStaleCommands, upsertCommandDispatchState } from "../_lib/commands.js";
import { isSlackDispatchConfigured } from "../_lib/dispatch.js";
import { deriveBridgeStatusFromCommands, readBridgeStatus, refreshBridgeStatusFromCommands, writeBridgeStatus } from "../_lib/status.js";
import { isAuthorized } from "../_lib/security.js";
import { readRuntimeConfig } from "../_lib/config.js";
import { classifySlackReply, fetchSlackThreadReplies } from "../_lib/slack.js";
import { upsertMessages } from "../_lib/messages.js";
import { DISPATCH_MODE_SLACK, getDispatchModeLabel } from "../_lib/dispatch.js";

async function syncSlackCommandReplies(env, command) {
  const channelId = String(command?.slackChannelId || "").trim();
  const threadTs = String(command?.slackThreadTs || command?.slackMessageTs || "").trim();

  if (!channelId || !threadTs) {
    return;
  }

  const replies = await fetchSlackThreadReplies(env, channelId, threadTs);
  const rootTs = String(command?.slackMessageTs || "").trim();
  const threadReplies = replies.filter((reply) => reply.ts && reply.ts !== rootTs && reply.text);

  if (!threadReplies.length) {
    return;
  }

  const latestReply = threadReplies.at(-1);
  const classification = classifySlackReply(latestReply.text);

  await upsertCommandDispatchState(env, {
    id: command.id,
    dispatchMode: DISPATCH_MODE_SLACK,
    status: classification.status,
    progressStage: classification.progressStage,
    slackChannelId: channelId,
    slackThreadTs: threadTs,
    slackMessageTs: rootTs,
    prUrl: classification.prUrl,
    branchName: classification.branchName,
    errorMessage: classification.status === "failed" ? latestReply.text : "",
    processingStartedAt: classification.status === "processing" ? new Date().toISOString() : ""
  });

  await upsertMessages(env, threadReplies.map((reply) => ({
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
}

async function syncRecentSlackReplies(env, runtimeConfig) {
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
    .slice(0, 5);

  for (const command of candidates) {
    try {
      await syncSlackCommandReplies(env, command);
    } catch {}
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const preflight = handleOptions(request);

  if (preflight) {
    return preflight;
  }

  if (request.method === "GET") {
    const runtimeConfig = await readRuntimeConfig(env);
    await syncRecentSlackReplies(env, runtimeConfig);
    await recoverStaleCommands(env, {
      preferSlack: isSlackDispatchConfigured(runtimeConfig),
      fallbackToLocal: true
    });
    const status = await deriveBridgeStatusFromCommands(env);
    return json({ status });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, { status: 405 });
  }

  if (!isAuthorized(request, env)) {
    return json({ error: "Unauthorized." }, { status: 401 });
  }

  let payload;

  try {
    payload = await request.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const current = await readBridgeStatus(env);
  const status = await writeBridgeStatus(env, {
    ...current,
    ...(payload?.status || {})
  });
  return json({ ok: true, status }, { status: 201 });
}
