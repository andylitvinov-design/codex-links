import { handleOptions, json, jsonStorageError } from "../_lib/http.js";
import { replaceMessages, upsertMessages, getMessagesForClient, readMessages } from "../_lib/messages.js";
import { isAuthorized } from "../_lib/security.js";

function normalizeEntryText(entry) {
  return String(entry?.text || "").trim().toLowerCase();
}

function isHiddenPublicMessage(entry) {
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

function filterPublicMessages(messages) {
  return (Array.isArray(messages) ? messages : []).filter((message) => !isHiddenPublicMessage(message));
}

export async function onRequest(context) {
  const { request, env } = context;
  const preflight = handleOptions(request);

  if (preflight) {
    return preflight;
  }

  if (request.method === "GET") {
    try {
      const url = new URL(request.url);
      const clientId = url.searchParams.get("clientId");
      const scope = url.searchParams.get("scope");

      if (scope === "recent") {
        if (!isAuthorized(request, env)) {
          return json({ error: "Unauthorized." }, { status: 401 });
        }

        const messages = await readMessages(env);
        return json({ messages });
      }

      if (scope === "public") {
        const messages = await readMessages(env);
        return json({ messages: filterPublicMessages(messages) });
      }

      if (clientId) {
        const messages = await getMessagesForClient(env, clientId);
        return json({ messages: filterPublicMessages(messages) });
      }

      if (!isAuthorized(request, env)) {
        return json({ error: "Unauthorized." }, { status: 401 });
      }

      const messages = await readMessages(env);
      return json({ messages });
    } catch (error) {
      return jsonStorageError(error, "Storage is rate limited. Messages are temporarily unavailable.");
    }
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, { status: 405 });
  }

  if (!isAuthorized(request, env)) {
    return json({ error: "Unauthorized." }, { status: 401 });
  }

  let payload;

  try {
    payload = await request.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  try {
    const messages = payload?.replace
      ? await replaceMessages(env, payload?.messages)
      : await upsertMessages(env, payload?.messages);
    return json({ ok: true, messages }, { status: 201 });
  } catch (error) {
    return jsonStorageError(error, "Storage is rate limited. Message write failed.");
  }
}
