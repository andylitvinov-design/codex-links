import { getCommandById, insertCommand } from "../../../_lib/commands.js";
import { readRuntimeConfig } from "../../../_lib/config.js";
import { dispatchModeToExecutorRoute } from "../../../_lib/dispatch.js";
import { handleOptions, json, jsonStorageError } from "../../../_lib/http.js";
import {
  buildProposalCommandPayload,
  getProposalById,
  markProposalDispatched,
  markProposalDispatchFailed
} from "../../../_lib/proposals.js";
import { isAuthorized } from "../../../_lib/security.js";
import { dispatchCommandIfNeeded, resolveRequestedDispatchMode } from "../../commands.js";

function linkedCommandInfo(proposal, command) {
  return {
    commandId: proposal?.commandId || command?.id || null,
    codexRunId: proposal?.codexRunId || command?.codexRunId || null,
    deliveryId: proposal?.deliveryId || command?.slackThreadTs || command?.slackMessageTs || null
  };
}

function isCommandDispatchFailure(command) {
  return String(command?.status || "").trim().toLowerCase() === "failed";
}

function dispatchFailureBody(command, stage = "dispatch-failed") {
  return {
    ok: false,
    error: "Proposal dispatch failed.",
    stage: command?.progressStage || command?.lastDiagnosticCode || stage,
    commandId: command?.id || null,
    command
  };
}

export async function onRequest(context) {
  const { request, env, params } = context;
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

  try {
    const proposal = await getProposalById(env, params?.proposalId);

    if (!proposal) {
      return json({ error: "Proposal not found." }, { status: 404 });
    }

    if (proposal.commandId || proposal.codexRunId || proposal.deliveryId) {
      const command = proposal.commandId ? await getCommandById(env, proposal.commandId) : null;
      return json({
        ok: true,
        duplicate: true,
        proposal,
        command,
        link: linkedCommandInfo(proposal, command)
      });
    }

    if (proposal.status !== "approved") {
      return json({ error: "Proposal is not approved." }, { status: 400 });
    }

    const runtimeConfig = await readRuntimeConfig(env);
    const basePayload = buildProposalCommandPayload(proposal);
    const dispatchMode = resolveRequestedDispatchMode(basePayload, runtimeConfig);
    const commandPayload = {
      ...basePayload,
      dispatchMode,
      targetExecutionMode: dispatchModeToExecutorRoute(dispatchMode)
    };
    const created = await insertCommand(env, commandPayload);

    if (!created.ok) {
      await markProposalDispatchFailed(env, proposal, {
        progressStage: "command-create-failed",
        lastDiagnosticDetail: created.error
      }, "command-create-failed");
      return json({
        ok: false,
        error: created.error,
        stage: "command-create-failed"
      }, { status: 400 });
    }

    const dispatched = await dispatchCommandIfNeeded(env, created.value, runtimeConfig);
    const command = dispatched?.command || await getCommandById(env, created.value.id) || created.value;

    if (isCommandDispatchFailure(command)) {
      const updatedProposal = await markProposalDispatchFailed(env, proposal, command, command.progressStage);
      return json({
        ...dispatchFailureBody(command, command.progressStage),
        proposal: updatedProposal
      }, { status: 502 });
    }

    const updatedProposal = await markProposalDispatched(env, proposal, command);
    return json({
      ok: true,
      proposal: updatedProposal,
      command,
      link: linkedCommandInfo(updatedProposal, command)
    });
  } catch (error) {
    return jsonStorageError(error, "Storage is rate limited. Proposal dispatch failed.");
  }
}
