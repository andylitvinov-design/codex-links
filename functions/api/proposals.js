import { handleOptions, json, jsonStorageError } from "../_lib/http.js";
import { isAuthorized } from "../_lib/security.js";
import { createProposal, listProposalsByThreadKey } from "../_lib/proposals.js";

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
    const threadKey = new URL(request.url).searchParams.get("threadKey");

    if (!String(threadKey || "").trim()) {
      return json({ error: "threadKey is required." }, { status: 400 });
    }

    try {
      return json({ proposals: await listProposalsByThreadKey(env, threadKey) });
    } catch (error) {
      return jsonStorageError(error, "Storage is rate limited. Proposals are temporarily unavailable.");
    }
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

  try {
    const created = await createProposal(env, payload);

    if (created?.ok === false) {
      return json({ error: created.error }, { status: 400 });
    }

    return json({ ok: true, proposal: created }, { status: 201 });
  } catch (error) {
    return jsonStorageError(error, "Storage is rate limited. Proposal write failed.");
  }
}
