import { readRuntimeConfig, readStoredConfig, updateStoredConfig, describeConfig } from "../_lib/config.js";
import { handleOptions, json } from "../_lib/http.js";
import { isAuthorized } from "../_lib/security.js";

export async function onRequest(context) {
  const { request, env } = context;
  const preflight = handleOptions(request);

  if (preflight) {
    return preflight;
  }

  if (!isAuthorized(request, env)) {
    return json({ error: "Unauthorized." }, { status: 401 });
  }

  if (request.method === "GET") {
    const stored = await readStoredConfig(env);
    const runtime = await readRuntimeConfig(env);
    return json({
      stored: describeConfig(stored),
      runtime: describeConfig(runtime)
    });
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

  const stored = await updateStoredConfig(env, payload?.config);
  const runtime = await readRuntimeConfig(env);

  return json({
    ok: true,
    stored: describeConfig(stored),
    runtime: describeConfig(runtime)
  }, { status: 201 });
}
