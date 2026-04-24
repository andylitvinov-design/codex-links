import {
  getCommandById,
  getCommandsForClient,
  runCommandMaintenance
} from "../../_lib/commands.js";
import { handleOptions, json } from "../../_lib/http.js";
import { isSlackDispatchConfigured } from "../../_lib/dispatch.js";
import { isAuthorized } from "../../_lib/security.js";
import { readRuntimeConfig } from "../../_lib/config.js";
import {
  dispatchCommandIfNeeded,
  syncRecentSlackReplies,
  syncSpecificSlackReplies
} from "../commands.js";

function serializeMaintenanceCommand(command) {
  if (!command || typeof command !== "object") {
    return command;
  }

  return {
    id: String(command.id || "").trim(),
    status: String(command.status || "").trim(),
    progressStage: String(command.progressStage || "").trim(),
    requestedExecutor: String(command.requestedExecutor || command.requestedMode || "").trim(),
    actualExecutor: String(command.actualExecutor || command.actualDispatchMode || "").trim(),
    fallbackCount: Number(command.fallbackCount || 0),
    fallbackReason: String(command.fallbackReason || "").trim(),
    timeoutPhase: String(command.timeoutPhase || "").trim(),
    firstAckAt: String(command.firstAckAt || "").trim(),
    resultAt: String(command.resultAt || "").trim(),
    slackThreadTs: String(command.slackThreadTs || "").trim()
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const preflight = handleOptions(request);

  if (preflight) {
    return preflight;
  }

  if (!isAuthorized(request, env)) {
    return json({ error: "Unauthorized." }, { status: 401 });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, { status: 405 });
  }

  let payload;

  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const runtimeConfig = await readRuntimeConfig(env);
  const allowSlack = isSlackDispatchConfigured(runtimeConfig);
  const commandId = String(payload?.commandId || "").trim();
  const clientId = String(payload?.clientId || "").trim();
  const syncReplies = payload?.syncReplies !== false;

  if (syncReplies && allowSlack) {
    if (commandId) {
      const command = await getCommandById(env, commandId);

      if (command) {
        await syncSpecificSlackReplies(env, runtimeConfig, [command]);
      }
    } else if (clientId) {
      const commands = await getCommandsForClient(env, clientId);
      await syncSpecificSlackReplies(env, runtimeConfig, commands);
    } else {
      await syncRecentSlackReplies(env, runtimeConfig);
    }
  }

  const maintenance = await runCommandMaintenance(env, {
    preferSlack: allowSlack,
    fallbackToLocal: true,
    fallbackToClaude: true
  });

  const commandsById = new Map(maintenance.commands.map((command) => [command.id, command]));
  const dispatched = [];

  for (const id of maintenance.commandsToDispatch) {
    const command = commandsById.get(id);

    if (!command) {
      continue;
    }

    const result = await dispatchCommandIfNeeded(env, command, runtimeConfig);
    if (result?.command?.id) {
      commandsById.set(result.command.id, result.command);
      dispatched.push(result.command.id);
    }
  }

  return json({
    ok: true,
    summary: {
      changed: maintenance.changed,
      changedCount: maintenance.changedCount,
      dispatchedCount: dispatched.length,
      syncReplies
    },
    commands: [...commandsById.values()]
      .filter((command) => !commandId || command.id === commandId)
      .map((command) => serializeMaintenanceCommand(command))
  });
}
