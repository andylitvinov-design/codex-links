import { handleOptions, json } from "../_lib/http.js";
import { isAuthorized } from "../_lib/security.js";
import { readThreads, writeThreads } from "../_lib/threads.js";

export async function onRequest(context) {
  const { request, env } = context;
  const preflight = handleOptions(request);

  if (preflight) {
    return preflight;
  }

  if (request.method === "GET") {
    const threads = await readThreads(env);
    return json({ threads });
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

  const threads = await writeThreads(env, payload?.threads);
  return json({ ok: true, threads }, { status: 201 });
}
