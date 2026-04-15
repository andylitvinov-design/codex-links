import { handleOptions, json } from "../_lib/http.js";
import { insertLink, readLinks } from "../_lib/links.js";
import { isAuthorized } from "../_lib/security.js";

export async function onRequest(context) {
  const { request, env } = context;
  const preflight = handleOptions(request);

  if (preflight) {
    return preflight;
  }

  if (request.method === "GET") {
    const links = await readLinks(env);
    return json({ links });
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

  const created = await insertLink(env, payload || {});

  if (!created.ok) {
    return json({ error: created.error }, { status: 400 });
  }

  return json({ ok: true, link: created.value }, { status: 201 });
}
