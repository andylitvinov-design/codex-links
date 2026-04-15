import {
  acknowledgeCommands,
  getCommandById,
  getCommandsForClient,
  insertCommand,
  listCommandThreads,
  readCommands
} from "../_lib/commands.js";
import { handleOptions, json } from "../_lib/http.js";
import { isAuthorized } from "../_lib/security.js";

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
      const threads = await listCommandThreads(env);
      return json({ threads });
    }

    if (commandId) {
      const command = await getCommandById(env, commandId);
      return json({ command });
    }

    if (scope === "recent") {
      const commands = await readCommands(env);
      const filtered = status
        ? commands.filter((command) => command.status === status)
        : commands;

      return json({ commands: filtered });
    }

    if (clientId) {
      const commands = await getCommandsForClient(env, clientId);
      const filtered = status
        ? commands.filter((command) => command.status === status)
        : commands;

      return json({ commands: filtered });
    }

    if (!isAuthorized(request, env)) {
      return json({ error: "Unauthorized." }, { status: 401 });
    }

    const commands = await readCommands(env);
    const filtered = status
      ? commands.filter((command) => command.status === status)
      : commands;

    return json({ commands: filtered });
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

  const created = await insertCommand(env, payload || {});

  if (!created.ok) {
    return json({ error: created.error }, { status: 400 });
  }

  return json({ ok: true, command: created.value }, { status: 201 });
}
