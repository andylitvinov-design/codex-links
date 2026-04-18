import { getCommandsForClient } from "../_lib/commands.js";
import { deriveBridgeStatusFromCommands } from "../_lib/status.js";
import { getMessagesForClient } from "../_lib/messages.js";
import { handleOptions, json, jsonStorageError } from "../_lib/http.js";
import { buildLatencyBreakdown, getVisibleDeliveryStage } from "../_lib/delivery.js";

function serializeCommand(command) {
  if (!command || typeof command !== "object") {
    return command;
  }

  return {
    ...command,
    deliveryStage: getVisibleDeliveryStage(command),
    latencyBreakdown: buildLatencyBreakdown(command)
  };
}

function isActiveCommand(command, now = Date.now()) {
  const status = String(command?.status || "").trim().toLowerCase();

  if (["queued", "dispatched", "processing"].includes(status)) {
    return true;
  }

  const createdAt = Date.parse(String(command?.createdAt || "").trim());

  if (Number.isFinite(createdAt) && (now - createdAt) <= 30_000) {
    return true;
  }

  const progressAt = Date.parse(String(command?.progressUpdatedAt || "").trim());
  return Number.isFinite(progressAt) && (now - progressAt) <= 30_000;
}

export async function onRequest(context) {
  const { request, env } = context;
  const preflight = handleOptions(request);

  if (preflight) {
    return preflight;
  }

  if (request.method !== "GET") {
    return json({ error: "Method not allowed." }, { status: 405 });
  }

  const url = new URL(request.url);
  const clientId = String(url.searchParams.get("clientId") || "").trim();
  const activeOnly = url.searchParams.get("activeOnly") === "1";

  if (!clientId) {
    return json({ error: "clientId is required." }, { status: 400 });
  }

  try {
    const [commands, messages, status] = await Promise.all([
      getCommandsForClient(env, clientId),
      getMessagesForClient(env, clientId),
      deriveBridgeStatusFromCommands(env)
    ]);

    const filteredCommands = activeOnly
      ? commands.filter((command) => isActiveCommand(command))
      : commands;
    const commandIds = new Set(filteredCommands.map((command) => String(command?.id || "").trim()).filter(Boolean));
    const filteredMessages = activeOnly
      ? messages.filter((message) => {
          const commandId = String(message?.commandId || "").trim();
          return !commandId || commandIds.has(commandId);
        })
      : messages;

    return json({
      serverTime: new Date().toISOString(),
      status,
      commands: filteredCommands.map((command) => serializeCommand(command)),
      messages: filteredMessages
    });
  } catch (error) {
    return jsonStorageError(error, "Storage is rate limited. Delivery snapshot is temporarily unavailable.");
  }
}
