import { handleOptions, json } from "../_lib/http.js";
import { replaceMessages, upsertMessages, getMessagesForClient, readMessages } from "../_lib/messages.js";
import { isAuthorized } from "../_lib/security.js";

export async function onRequest(context) {
  const { request, env } = context;
  const preflight = handleOptions(request);

  if (preflight) {
    return preflight;
  }

  if (request.method === "GET") {
    const url = new URL(request.url);
    const clientId = url.searchParams.get("clientId");
    const scope = url.searchParams.get("scope");

    if (scope === "recent") {
      const messages = await readMessages(env);
      return json({ messages });
    }

    if (clientId) {
      const messages = await getMessagesForClient(env, clientId);
      return json({ messages });
    }

    if (!isAuthorized(request, env)) {
      return json({ error: "Unauthorized." }, { status: 401 });
    }

    const messages = await readMessages(env);
    return json({ messages });
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

  const messages = payload?.replace
    ? await replaceMessages(env, payload?.messages)
    : await upsertMessages(env, payload?.messages);
  return json({ ok: true, messages }, { status: 201 });
}
