import { handleOptions, json, jsonStorageError } from "../../../_lib/http.js";
import { isAuthorized } from "../../../_lib/security.js";
import { approveProposal } from "../../../_lib/proposals.js";

export async function onRequest(context) {
  const { request, env, params } = context;
  const preflight = handleOptions(request);

  if (preflight) {
    return preflight;
  }

  if (!isAuthorized(request, env)) {
    return json({ error: "Unauthorized." }, { status: 401 });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, { status: 405 });
  }

  let payload = {};

  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  try {
    const approved = await approveProposal(env, params?.proposalId, payload);

    if (!approved.ok) {
      return json({ error: approved.error }, { status: approved.status || 400 });
    }

    return json({ ok: true, proposal: approved.value });
  } catch (error) {
    return jsonStorageError(error, "Storage is rate limited. Proposal approval failed.");
  }
}
