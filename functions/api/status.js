import { handleOptions, json } from "../_lib/http.js";
import { deriveBridgeStatusFromCommands, readBridgeStatus, refreshBridgeStatusFromCommands, writeBridgeStatus } from "../_lib/status.js";
import { isAuthorized } from "../_lib/security.js";

export async function onRequest(context) {
  const { request, env } = context;
  const preflight = handleOptions(request);

  if (preflight) {
    return preflight;
  }

  if (request.method === "GET") {
    const status = await deriveBridgeStatusFromCommands(env);
    return json({ status });
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

  const current = await readBridgeStatus(env);
  const status = await writeBridgeStatus(env, {
    ...current,
    ...(payload?.status || {})
  });
  return json({ ok: true, status }, { status: 201 });
}
