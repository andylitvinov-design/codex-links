import { describePublicConfig, readRuntimeConfig } from "../_lib/config.js";
import { handleOptions, json } from "../_lib/http.js";

export async function onRequest(context) {
  const { request, env } = context;
  const preflight = handleOptions(request);

  if (preflight) {
    return preflight;
  }

  if (request.method !== "GET") {
    return json({ error: "Method not allowed." }, { status: 405 });
  }

  const runtime = await readRuntimeConfig(env);
  return json(describePublicConfig(runtime));
}
