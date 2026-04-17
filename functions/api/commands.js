import {
  acknowledgeCommands,
  claimNextCommand,
  fallbackCommandToLocalBridge,
  markCommandDispatched,
  markCommandFailed,
  getCommandById,
  getCommandsForClient,
  insertCommand,
  listCommandThreads,
  recoverStaleSlackCommands,
  requeueCommand,
  readCommands,
  updateCommandProgress,
  writeCommands
} from "../_lib/commands.js";
import { handleOptions, json } from "../_lib/http.js";
import {
  DISPATCH_MODE_LOCAL,
  DISPATCH_MODE_SLACK,
  getConfiguredDispatchMode,
  getDispatchModeLabel,
  getSlackCodexMention
} from "../_lib/dispatch.js";
import { isAuthorized } from "../_lib/security.js";
import { postSlackCommand } from "../_lib/slack.js";
import { refreshBridgeStatusFromCommands } from "../_lib/status.js";
import { readRuntimeConfig } from "../_lib/config.js";

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
    photo
  };
}

function serializeCommands(commands) {
  return (Array.isArray(commands) ? commands : []).map((command) => serializeCommand(command));
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
    state: "idle",
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
      state: "idle",
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
      "Cloud Slack dispatch v1 does not support photo attachments yet. Falling back to local bridge."
    );

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
      state: "idle",
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
    await recoverStaleSlackCommands(env);
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
      const filtered = status
        ? commands.filter((command) => command.status === status)
        : commands;

      return json({ commands: serializeCommands(filtered) });
    }

    if (clientId) {
      const commands = await getCommandsForClient(env, clientId);
      const filtered = status
        ? commands.filter((command) => command.status === status)
        : commands;

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
  await recoverStaleSlackCommands(env);
  const created = await insertCommand(env, {
    ...(payload || {}),
    dispatchMode: payload?.dispatchMode || getConfiguredDispatchMode(runtimeConfig)
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
