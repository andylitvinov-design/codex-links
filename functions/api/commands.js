import {
  acknowledgeCommands,
  claimNextCommand,
  fallbackCommandToLocalBridge,
  markCommandDispatched,
  getCommandById,
  getCommandsForClient,
  insertCommand,
  listCommandThreads,
  recoverStaleCommands,
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
import { classifySlackReply, fetchSlackThreadReplies, postSlackCommand } from "../_lib/slack.js";
import { upsertMessages } from "../_lib/messages.js";
import { refreshBridgeStatusFromCommands } from "../_lib/status.js";
import { readRuntimeConfig } from "../_lib/config.js";

function normalizeEntryText(entry) {
  return String(entry?.text || "").trim().toLowerCase();
}

function isHiddenPublicCommand(entry) {
  const text = normalizeEntryText(entry);

  return (
    text.includes("delivery-probe")
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
    targetRepo: String(command.targetRepo || "").trim(),
    targetRepoUrl: String(command.targetRepoUrl || "").trim(),
    targetContextFiles: Array.isArray(command.targetContextFiles) ? command.targetContextFiles : [],
    targetExecutionMode: String(command.targetExecutionMode || "").trim()
  };
}

function serializeCommands(commands) {
  return (Array.isArray(commands) ? commands : []).map((command) => serializeCommand(command));
}

function shouldDispatchQueuedSlackCommand(command) {
  const status = String(command?.status || "").trim().toLowerCase();
  const dispatchMode = String(command?.dispatchMode || "").trim().toLowerCase();
  const text = String(command?.text || "").trim().toLowerCase();

  if (status !== "queued" || dispatchMode !== DISPATCH_MODE_SLACK) {
    return false;
  }

  if (!text || text.includes("codex cloud routing probe ignore")) {
    return false;
  }

  if (command?.photo) {
    return false;
  }

  return true;
}

function shouldRetryCloudFallback(command) {
  const status = String(command?.status || "").trim().toLowerCase();
  const dispatchMode = String(command?.dispatchMode || "").trim().toLowerCase();
  const errorMessage = String(command?.errorMessage || "").trim();
  const text = String(command?.text || "").trim().toLowerCase();

  if (status !== "queued" || dispatchMode !== DISPATCH_MODE_LOCAL) {
    return false;
  }

  if (!errorMessage || !/slack .*falling back to local bridge\./i.test(errorMessage)) {
    return false;
  }

  if (!text || text.includes("codex cloud routing probe ignore")) {
    return false;
  }

  if (command?.photo) {
    return false;
  }

  const updatedAt = Date.parse(String(command?.progressUpdatedAt || command?.createdAt || "").trim());

  if (Number.isNaN(updatedAt) || (Date.now() - updatedAt) < 2 * 60 * 1000) {
    return false;
  }

  return true;
}

async function retryCloudFallbackCommands(env, runtimeConfig) {
  if (!isSlackDispatchConfigured(runtimeConfig)) {
    return;
  }

  let current = await readCommands(env);
  const candidates = current
    .filter((command) => shouldDispatchQueuedSlackCommand(command) || shouldRetryCloudFallback(command))
    .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")))
    .slice(0, 6);

  for (const candidate of candidates) {
    let refreshed = candidate;

    if (shouldRetryCloudFallback(candidate)) {
      const nowIso = new Date().toISOString();
      const next = current.map((command) => {
        if (command.id !== candidate.id) {
          return command;
        }

        return {
          ...command,
          dispatchMode: DISPATCH_MODE_SLACK,
          status: "queued",
          progressStage: "queued",
          progressUpdatedAt: nowIso,
          errorMessage: "",
          completedAt: ""
        };
      });

      await writeCommands(env, next);
      current = next;
      refreshed = next.find((command) => command.id === candidate.id) || candidate;
    }

    await dispatchCommandIfNeeded(env, refreshed, runtimeConfig);
    current = await readCommands(env);
  }
}

async function syncSlackCommandReplies(env, command) {
  const channelId = String(command?.slackChannelId || "").trim();
  const threadTs = String(command?.slackThreadTs || command?.slackMessageTs || "").trim();

  if (!channelId || !threadTs) {
    return false;
  }

  const replies = await fetchSlackThreadReplies(env, channelId, threadTs);
  const rootTs = String(command?.slackMessageTs || "").trim();
  const threadReplies = replies.filter((reply) => reply.ts && reply.ts !== rootTs && reply.text);

  if (!threadReplies.length) {
    return false;
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

  return classification.status === "answered" || classification.status === "failed";
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
    .sort((left, right) => String(right.progressUpdatedAt || right.dispatchedAt || right.createdAt || "").localeCompare(String(left.progressUpdatedAt || left.dispatchedAt || right.createdAt || "")))
    .slice(0, 5);

  for (const command of candidates) {
    try {
      await syncSlackCommandReplies(env, command);
    } catch {}
  }
}

async function fallbackToLocalBridge(env, command, errorMessage) {
  const fallback = await fallbackCommandToLocalBridge(env, {
    id: command.id,
    progressStage: "queued",
    errorMessage
  });

  await refreshBridgeStatusFromCommands(env, {
    dispatchMode: DISPATCH_MODE_LOCAL,
    executorLabel: getDispatchModeLabel(DISPATCH_MODE_LOCAL),
    bridgeOnline: true,
    lastRunAt: new Date().toISOString(),
    lastError: errorMessage
  });

  return fallback.value || command;
}

async function dispatchCommandIfNeeded(env, command, runtimeConfig) {
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

  if (command?.photo) {
    const fallbackCommand = await fallbackToLocalBridge(
      env,
      command,
      "Cloud does not support photo attachments yet. Falling back to local bridge."
    );

    await refreshBridgeStatusFromCommands(env, {
      dispatchMode: DISPATCH_MODE_LOCAL,
      executorLabel: getDispatchModeLabel(DISPATCH_MODE_LOCAL),
      bridgeOnline: true,
      lastRunAt: new Date().toISOString(),
      lastError: "Cloud does not support photo attachments yet. Falling back to local bridge."
    });

    return {
      ok: true,
      command: fallbackCommand
    };
  }

  try {
    const published = await postSlackCommand(config, command, getSlackCodexMention(config));
    const dispatched = await markCommandDispatched(env, {
      id: command.id,
      dispatchMode,
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
    const fallbackCommand = await fallbackToLocalBridge(
      env,
      command,
      `Slack dispatch failed. Falling back to local bridge. ${errorMessage}`.trim()
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
    const runtimeConfig = await readRuntimeConfig(env);
    await syncRecentSlackReplies(env, runtimeConfig);
    await recoverStaleCommands(env, {
      preferSlack: isSlackDispatchConfigured(runtimeConfig),
      fallbackToLocal: true
    });
    await retryCloudFallbackCommands(env, runtimeConfig);
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
  await syncRecentSlackReplies(env, runtimeConfig);
  const dispatchMode = getConfiguredDispatchMode(runtimeConfig);
  await recoverStaleCommands(env, {
    preferSlack: isSlackDispatchConfigured(runtimeConfig),
    fallbackToLocal: true
  });
  await retryCloudFallbackCommands(env, runtimeConfig);
  const created = await insertCommand(env, {
    ...(payload || {}),
    dispatchMode: payload?.dispatchMode || dispatchMode
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
