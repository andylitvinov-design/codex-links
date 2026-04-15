import { COMMANDS_STORAGE_KEY, HISTORY_RETENTION_MS, MAX_COMMANDS } from "./constants.js";

function normalizeText(rawText) {
  return String(rawText || "").trim().slice(0, 2000);
}

function normalizeClientId(rawClientId) {
  return String(rawClientId || "").trim().slice(0, 120);
}

function normalizeThreadId(rawThreadId) {
  return String(rawThreadId || "").trim().slice(0, 160);
}

function normalizeThreadLabel(rawThreadLabel, threadId) {
  const value = String(rawThreadLabel || "").trim().slice(0, 120);
  return value || threadId || "Links";
}

function normalizePhoto(input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const dataUrl = String(input.dataUrl || "").trim();
  const contentType = String(input.contentType || "").trim().toLowerCase();
  const fileName = String(input.fileName || "").trim().slice(0, 120);
  const size = Number(input.size || 0);

  if (!dataUrl) {
    return null;
  }

  if (!contentType.startsWith("image/")) {
    return {
      ok: false,
      error: "Photo must be an image."
    };
  }

  if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) {
    return {
      ok: false,
      error: "Photo must be sent as a data URL."
    };
  }

  if (dataUrl.length > 6_000_000 || size > 4_500_000) {
    return {
      ok: false,
      error: "Photo is too large. Use an image up to 4.5 MB."
    };
  }

  return {
    ok: true,
    value: {
      fileName: fileName || "photo",
      contentType,
      size,
      dataUrl
    }
  };
}

function isWithinRetentionWindow(value) {
  const timestamp = Date.parse(String(value || "").trim());

  if (Number.isNaN(timestamp)) {
    return false;
  }

  return timestamp >= Date.now() - HISTORY_RETENTION_MS;
}

export function createCommandRecord(input) {
  const text = normalizeText(input.text);
  const clientId = normalizeClientId(input.clientId);
  const threadId = normalizeThreadId(input.threadId);
  const threadLabel = normalizeThreadLabel(input.threadLabel, threadId);
  const normalizedPhoto = normalizePhoto(input.photo);

  if (normalizedPhoto && !normalizedPhoto.ok) {
    return normalizedPhoto;
  }

  if (!text && !normalizedPhoto?.value) {
    return {
      ok: false,
      error: "Command text or photo is required."
    };
  }

  return {
    ok: true,
    value: {
      id: crypto.randomUUID(),
      text,
      clientId,
      threadId,
      threadLabel,
      photo: normalizedPhoto?.value || null,
      createdAt: new Date().toISOString(),
      status: "pending",
      source: "site"
    }
  };
}

export async function readCommands(env) {
  const existing = await env.LINKS_STORE.get(COMMANDS_STORAGE_KEY, "json");

  if (!Array.isArray(existing)) {
    return [];
  }

  return existing
    .filter((entry) => entry && typeof entry === "object" && typeof entry.text === "string")
    .filter((entry) => isWithinRetentionWindow(entry.createdAt))
    .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
}

export async function writeCommands(env, commands) {
  const trimmed = commands
    .filter((command) => isWithinRetentionWindow(command?.createdAt))
    .slice(-MAX_COMMANDS);
  await env.LINKS_STORE.put(COMMANDS_STORAGE_KEY, JSON.stringify(trimmed));
  return trimmed;
}

export async function insertCommand(env, input) {
  const normalized = createCommandRecord(input);

  if (!normalized.ok) {
    return normalized;
  }

  const current = await readCommands(env);
  current.push(normalized.value);
  await writeCommands(env, current);

  return normalized;
}

export async function acknowledgeCommands(env, ids) {
  const idSet = new Set(
    (Array.isArray(ids) ? ids : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );

  if (!idSet.size) {
    return {
      ok: false,
      error: "At least one command id is required."
    };
  }

  const current = await readCommands(env);
  const next = current.map((command) => {
    if (!idSet.has(command.id)) {
      return command;
    }

    return {
      ...command,
      status: "acked",
      ackedAt: new Date().toISOString()
    };
  });

  await writeCommands(env, next);

  return {
    ok: true,
    value: next.filter((command) => idSet.has(command.id))
  };
}

export async function getCommandsForClient(env, clientId) {
  const normalizedClientId = normalizeClientId(clientId);

  if (!normalizedClientId) {
    return [];
  }

  const commands = await readCommands(env);
  return commands.filter((command) => command.clientId === normalizedClientId);
}

export async function getCommandById(env, id) {
  const normalizedId = String(id || "").trim();

  if (!normalizedId) {
    return null;
  }

  const commands = await readCommands(env);
  return commands.find((command) => command.id === normalizedId) || null;
}

export async function listCommandThreads(env) {
  const commands = await readCommands(env);
  const threads = new Map();

  commands.forEach((command) => {
    const threadId = normalizeThreadId(command.threadId);
    const threadLabel = normalizeThreadLabel(command.threadLabel, threadId);

    if (!threadId || threads.has(threadId)) {
      return;
    }

    threads.set(threadId, {
      id: threadId,
      label: threadLabel
    });
  });

  if (!threads.size) {
    threads.set("links", {
      id: "links",
      label: "Links"
    });
  }

  return [...threads.values()].sort((left, right) => left.label.localeCompare(right.label, "ru"));
}
