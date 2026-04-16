import { getCommandsForClient, readCommands } from "../_lib/commands.js";
import { buildCsv, buildExportFilename, buildExportRows, getExportQuery, isWithinExportRange } from "../_lib/export.js";
import { handleOptions, json, text } from "../_lib/http.js";
import { readLinks } from "../_lib/links.js";
import { getMessagesForClient, readMessages } from "../_lib/messages.js";
import { isAuthorized } from "../_lib/security.js";

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
  const parsed = getExportQuery(url.searchParams);

  if (!parsed.ok) {
    return json({ error: parsed.error }, { status: 400 });
  }

  const { dataset, from, to } = parsed.value;
  const clientId = String(url.searchParams.get("clientId") || "").trim();
  const authorized = isAuthorized(request, env);
  const needsClientScopedData = dataset === "all" || dataset === "commands" || dataset === "messages";

  if (needsClientScopedData && !authorized && !clientId) {
    return json({ error: "clientId is required for command/message export." }, { status: 400 });
  }

  const range = { from, to };
  const rowsInput = {};

  if (dataset === "all" || dataset === "commands") {
    const commands = authorized ? await readCommands(env) : await getCommandsForClient(env, clientId);
    rowsInput.commands = commands.filter((entry) => isWithinExportRange(entry.createdAt, range));
  }

  if (dataset === "all" || dataset === "messages") {
    const messages = authorized ? await readMessages(env) : await getMessagesForClient(env, clientId);
    rowsInput.messages = messages.filter((entry) => isWithinExportRange(entry.createdAt, range));
  }

  if (dataset === "all" || dataset === "links") {
    const links = await readLinks(env);
    rowsInput.links = links.filter((entry) => isWithinExportRange(entry.createdAt, range));
  }

  const rows = buildExportRows(rowsInput);
  const filename = buildExportFilename(dataset, range);
  const csv = buildCsv(rows);

  return text(csv, {
    headers: {
      "content-type": "text/csv; charset=UTF-8",
      "content-disposition": `attachment; filename=\"${filename}\"`
    }
  });
}
