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
import { handleOptions, json } from "../_lib/http.js";
import {
  DISPATCH_MODE_LOCAL,
  DISPATCH_MODE_SLACK,
  getConfiguredDispatchMode,
  getDispatchModeLabel,
  isSlackDispatchConfigured,
  getSlackCodexMention
} from "../_lib/dispatch.js";
import { isAuthorized } from "../_lib/security.js";
import { classifySlackReply, fetchSlackChannelMessages, fetchSlackThreadReplies, isLikelyCodexSlackActor, postSlackCommand } from "../_lib/slack.js";
import { upsertMessages } from "../_lib/messages.js";
import { refreshBridgeStatusFromCommands } from "../_lib/status.js";
import { readRuntimeConfig } from "../_lib/config.js";
import { stringifyCommandError } from "../_lib/command-debug.js";
import { resolveProjectDispatchTarget } from "../_lib/project-dispatch-manifest.js";

const MAX_RECENT_SLACK_SYNC_COMMANDS = 20;

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

function serializeCommand(command) {
  if (!command || typeof command !== "object") {
    return command;
  }

  const photo = command.photo && typeof command.photo === "object"
    ? {
        contentType: String(command.photo.contentType || "").trim(),
        fileName: String(command.photo.fileName || "").trim(),
        size: Number(command.photo.size || 0),
        hasDataUrl: Boolean(String(command.photo.dataUrl || "").trim())
      }
    : null;

  return {
    ...command,
    photo,
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

function serializeCommands(commands) {
  return (Array.isArray(commands) ? commands : []).map((command) => serializeCommand(command));
}

export async function syncSlackCommandReplies(env, command, runtimeConfig, options = {}) {
  const channelId = String(command?.slackChannelId || "").trim();
  const threadTs = String(command?.slackThreadTs || command?.slackMessageTs || "").trim();

  if (!channelId || !threadTs) {
    return false;
  }

  const replies = await fetchSlackThreadReplies(env, channelId, threadTs);
  const rootTs = String(command?.slackMessageTs || "").trim();
  const threadReplies = replies.filter((reply) => reply.ts && reply.ts !== rootTs && reply.text);

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

export async function dispatchCommandIfNeeded(env, command, runtimeConfig) {
  const config = runtimeConfig || await readRuntimeConfig(env);
  const dispatchMode = command?.dispatchMode || getConfiguredDispatchMode(config);

  if (dispatchMode !== DISPATCH_MODE_SLACK) {
    await refreshBridgeStatusFromCommands(env, {
      dispatchMode,
      executorLabel: getDispatchModeLabel(dispatchMode),
      bridgeOnline: true,
      lastRunAt: new Date().toISOString()
    });
    return {
      ok: true,
      command
    };
  }

  try {
    const published = await postSlackCommand(config, command, getSlackCodexMention(config));
    const dispatched = await markCommandDispatched(env, {
      id: command.id,
      dispatchMode,
      progressStage: "sent-to-slack",
      slackChannelId: published.channel,
      slackMessageTs: published.ts,
      slackThreadTs: published.threadTs,
      dispatchedAt: new Date().toISOString()
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
      command: dispatched.value || command
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

export async function onRequest(context) {
  const { request, env } = context;
  const preflight = handleOptions(request);

  if (preflight) {
    return preflight;
  }

  if (request.method === "GET") {
    const url = new URL(request.url);
    const commandId = url.searchParams.get("id");
    const clientId = url.searchParams.get("clientId");
    const status = url.searchParams.get("status");
    const catalog = url.searchParams.get("catalog");
    const scope = url.searchParams.get("scope");

    if (catalog === "threads") {
      if (!isAuthorized(request, env)) {
        return json({ error: "Unauthorized." }, { status: 401 });
      }

      const threads = await listCommandThreads(env);
      return json({ threads });
    }

    if (commandId) {
      const command = await getCommandById(env, commandId);
      return json({ command });
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
      firstAckAt: payload?.firstAckAt,
      resultAt: payload?.resultAt,
      prUrl: payload?.prUrl,
      branchName: payload?.branchName
    });

    if (!answered.ok) {
      return json({ error: answered.error }, { status: 400 });
    }

    return json({ ok: true, command: serializeCommand(answered.value) });
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
      resultAt: payload?.resultAt,
      timeoutPhase: payload?.timeoutPhase,
      lastDiagnosticCode: payload?.lastDiagnosticCode,
      lastDiagnosticDetail: payload?.lastDiagnosticDetail
    });

    if (!failed.ok) {
      return json({ error: failed.error }, { status: 400 });
    }

    return json({ ok: true, command: serializeCommand(failed.value) });
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

    return json({ ok: true, command: claimed.value });
  }

  if (action === "progress") {
    if (!isAuthorized(request, env)) {
      return json({ error: "Unauthorized." }, { status: 401 });
    }

    const updated = await updateCommandProgress(env, {
      id: payload?.id,
      progressStage: payload?.progressStage,
      progressUpdatedAt: payload?.progressUpdatedAt,
      processingLeaseUntil: payload?.processingLeaseUntil
    });

    if (!updated.ok) {
      return json({ error: updated.error }, { status: 400 });
    }

    return json({ ok: true, command: updated.value });
  }

  if (action === "requeue") {
    if (!isAuthorized(request, env)) {
      return json({ error: "Unauthorized." }, { status: 401 });
    }

    const requeued = await requeueCommand(env, payload?.id);

    if (!requeued.ok) {
      return json({ error: requeued.error }, { status: 400 });
    }

    return json({ ok: true, command: requeued.value });
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
    return json({ ok: true, commands: serializeCommands(commands) });
  }

  const runtimeConfig = await readRuntimeConfig(env);
  const dispatchMode = getConfiguredDispatchMode(runtimeConfig);
  const requestedDispatchMode = payload?.dispatchMode || dispatchMode;
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

  const created = await insertCommand(env, {
    ...(payload || {}),
    dispatchMode: requestedDispatchMode,
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
  const dispatched = await dispatchCommandIfNeeded(env, command, runtimeConfig);

  if (!dispatched.ok) {
    return json({
      error: dispatched.error,
      command: dispatched.command
    }, { status: dispatched.status || 502 });
  }

  return json({ ok: true, command: serializeCommand(dispatched.command) }, { status: 201 });
}
