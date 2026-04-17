import { handleOptions, json } from "../_lib/http.js";
import { listVisibleProjectTargets } from "../_lib/project-dispatch-manifest.js";
import { listEligibleCloudRepos, readRepoContexts, writeRepoContexts } from "../_lib/repos.js";
import { isAuthorized } from "../_lib/security.js";

export async function onRequest(context) {
  const { request, env } = context;
  const preflight = handleOptions(request);

  if (preflight) {
    return preflight;
  }

  if (request.method === "GET") {
    const data = listVisibleProjectTargets();
    return json(data);
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

  const previousManifest = await readRepoContexts(env);
  const repos = await writeRepoContexts(env, payload?.repos);
  const eligible = await listEligibleCloudRepos(env);

  return json({
    ok: true,
    manifest: repos,
    eligible,
    previousManifestSize: previousManifest.length
  }, { status: 201 });
}
