import { getCommandsForClient, readCommands } from "../_lib/commands.js";
import { deriveBridgeStatusFromCommands } from "../_lib/status.js";
import { getMessagesForClient, readMessages } from "../_lib/messages.js";
import { readReports } from "../_lib/reports.js";
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

function isHiddenPublicEntry(entry) {
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
  const scope = String(url.searchParams.get("scope") || "").trim().toLowerCase();
  const activeOnly = url.searchParams.get("activeOnly") === "1";

  try {
    const usePublicScope = scope === "public";

    if (!usePublicScope && !clientId) {
      return json({ error: "clientId is required." }, { status: 400 });
    }

    const [commands, messages, reports, status] = await Promise.all(usePublicScope
      ? [
          readCommands(env),
          readMessages(env),
          readReports(env),
          deriveBridgeStatusFromCommands(env)
        ]
      : [
          getCommandsForClient(env, clientId),
          getMessagesForClient(env, clientId),
          readReports(env),
          deriveBridgeStatusFromCommands(env)
        ]);

    const visibleCommands = usePublicScope
      ? commands.filter((command) => !isHiddenPublicEntry(command))
      : commands;
    const visibleMessages = usePublicScope
      ? messages.filter((message) => !isHiddenPublicEntry(message))
      : messages;

    const filteredCommands = activeOnly
      ? visibleCommands.filter((command) => isActiveCommand(command))
      : visibleCommands;
    const commandIds = new Set(filteredCommands.map((command) => String(command?.id || "").trim()).filter(Boolean));
    const filteredMessages = activeOnly
      ? visibleMessages.filter((message) => {
          const commandId = String(message?.commandId || "").trim();
          return !commandId || commandIds.has(commandId);
        })
      : visibleMessages;

    return json({
      serverTime: new Date().toISOString(),
      status,
      commands: filteredCommands.map((command) => serializeCommand(command)),
      messages: filteredMessages,
      reports: reports
    });
  } catch (error) {
    return jsonStorageError(error, "Storage is rate limited. Delivery snapshot is temporarily unavailable.");
  }
}
