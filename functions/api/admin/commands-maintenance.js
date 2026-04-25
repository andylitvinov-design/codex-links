import {
  getCommandById,
  getCommandsForClient,
  runCommandMaintenance
} from "../../_lib/commands.js";
import { handleOptions, json } from "../../_lib/http.js";
import { isSlackDispatchConfigured } from "../../_lib/dispatch.js";
import { isAuthorized } from "../../_lib/security.js";
import { readRuntimeConfig } from "../../_lib/config.js";
import { runSlackActorDiagnostic } from "../../_lib/slack.js";
import { refreshBridgeStatusFromCommands } from "../../_lib/status.js";
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
    owner: String(command.processorId || command.actualExecutor || command.actualDispatchMode || command.dispatchMode || "").trim(),
    diagnosticCode: String(command.lastDiagnosticCode || "").trim(),
    diagnosticDetail: String(command.lastDiagnosticDetail || command.errorMessage || "").trim(),
    firstAckAt: String(command.firstAckAt || "").trim(),
    resultAt: String(command.resultAt || "").trim(),
    slackThreadTs: String(command.slackThreadTs || "").trim()
  };
}

function routeKey(command) {
  const mode = String(command?.dispatchMode || "").trim();
  const executor = String(command?.actualExecutor || command?.actualDispatchMode || command?.requestedExecutor || "").trim();
  if (mode === "slack-codex-cloud") return "cloudViaSlack";
  if (mode === "cloud" || executor === "direct-openai") return "directOpenai";
  if (mode === "claude-bridge") return "claudeBridge";
  return "localBridge";
}

function buildEmptyRouteSummary() {
  return {
    queued: 0,
    processing: 0,
    fallbackApplied: 0,
    failed: 0,
    unchanged: 0,
    oldestPendingAt: ""
  };
}

function describeUnchanged(command) {
  const diagnostic = String(command?.lastDiagnosticDetail || command?.errorMessage || command?.fallbackReason || "").trim();
  if (diagnostic) return diagnostic;
  const owner = String(command?.processorId || command?.actualExecutor || command?.actualDispatchMode || command?.dispatchMode || "").trim();
  if (owner) return `owned by ${owner}`;
  return "no timeout or fallback rule matched";
}

function buildMaintenanceSummary(commands, maintenance, dispatchedIds = []) {
  const changedIds = new Set((Array.isArray(maintenance?.changedCommands) ? maintenance.changedCommands : [])
    .map((command) => String(command?.id || "").trim())
    .filter(Boolean));
  const dispatched = new Set((Array.isArray(dispatchedIds) ? dispatchedIds : []).map((id) => String(id || "").trim()).filter(Boolean));
  const routes = {
    cloudViaSlack: buildEmptyRouteSummary(),
    directOpenai: buildEmptyRouteSummary(),
    localBridge: buildEmptyRouteSummary(),
    claudeBridge: buildEmptyRouteSummary()
  };
  const remaining = [];

  for (const command of Array.isArray(commands) ? commands : []) {
    const key = routeKey(command);
    const bucket = routes[key] || routes.localBridge;
    const status = String(command?.status || "").trim().toLowerCase();
    const id = String(command?.id || "").trim();
    const active = status === "queued" || status === "dispatched" || status === "processing";
    const changed = changedIds.has(id);

    if (status === "queued" || status === "dispatched") {
      bucket.queued += 1;
    }

    if (status === "processing") {
      bucket.processing += 1;
    }

    if ((active || changed || dispatched.has(id)) && (Boolean(command?.fallbackApplied) || /^fallback-to-/i.test(String(command?.progressStage || "")))) {
      bucket.fallbackApplied += 1;
    }

    if (changed && status === "failed") {
      bucket.failed += 1;
    }

    if (active && !changed && !dispatched.has(id)) {
      bucket.unchanged += 1;
      remaining.push({
        id,
        status,
        route: key,
        owner: String(command?.processorId || command?.actualExecutor || command?.actualDispatchMode || command?.dispatchMode || "").trim(),
        reason: describeUnchanged(command)
      });
    }

    if (active) {
      const pendingAt = String(command?.createdAt || command?.progressUpdatedAt || "").trim();
      if (pendingAt && (!bucket.oldestPendingAt || pendingAt < bucket.oldestPendingAt)) {
        bucket.oldestPendingAt = pendingAt;
      }
    }
  }

  return {
    updatedAt: new Date().toISOString(),
    changed: Boolean(maintenance?.changed),
    changedCount: Number(maintenance?.changedCount || 0),
    dispatchedCount: dispatched.size,
    routes,
    remaining: remaining.slice(0, 20)
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
  const action = String(payload?.action || "maintenance").trim();

  if (action === "slack-diagnostic" || action === "diagnose-slack-actor") {
    const diagnostic = await runSlackActorDiagnostic(runtimeConfig, {
      timeoutMs: Number(payload?.timeoutMs || 10_000),
      pollIntervalMs: Number(payload?.pollIntervalMs || 1_000)
    });

    await refreshBridgeStatusFromCommands(env, {
      slackActor: {
        configuredUserId: diagnostic.targetUserId,
        validationStatus: diagnostic.validationStatus,
        lastValidatedAt: diagnostic.completedAt,
        validationError: diagnostic.ok ? "" : (diagnostic.detail || diagnostic.message),
        probeChannelId: diagnostic.channelId,
        probeMessageTs: diagnostic.probeMessageTs,
        probeThreadTs: diagnostic.probeThreadTs,
        lastProbeAt: diagnostic.completedAt,
        lastProbeError: diagnostic.ok ? "" : (diagnostic.detail || diagnostic.message),
        lastProbeResult: diagnostic
      },
      lastError: diagnostic.ok ? "" : (diagnostic.detail || diagnostic.message || "Slack actor diagnostic did not validate the worker.")
    });

    return json({
      ok: true,
      slackActorDiagnostic: diagnostic
    });
  }

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

  const summary = buildMaintenanceSummary([...commandsById.values()], maintenance, dispatched);
  await refreshBridgeStatusFromCommands(env, { maintenanceSummary: summary });

  return json({
    ok: true,
    summary: {
      ...summary,
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
