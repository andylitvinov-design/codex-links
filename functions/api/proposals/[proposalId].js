import { handleOptions, json, jsonStorageError } from "../../_lib/http.js";
import { isAuthorized } from "../../_lib/security.js";
import { getProposalById } from "../../_lib/proposals.js";

export async function onRequest(context) {
  const { request, env, params } = context;
  const preflight = handleOptions(request);

  if (preflight) {
    return preflight;
  }

  if (!isAuthorized(request, env)) {
    return json({ error: "Unauthorized." }, { status: 401 });
  }

  if (request.method !== "GET") {
    return json({ error: "Method not allowed." }, { status: 405 });
  }

  try {
    const proposal = await getProposalById(env, params?.proposalId);

    if (!proposal) {
      return json({ error: "Proposal not found." }, { status: 404 });
    }

    return json({ proposal });
  } catch (error) {
    return jsonStorageError(error, "Storage is rate limited. Proposal read failed.");
  }
}
