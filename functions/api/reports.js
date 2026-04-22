import { handleOptions, json, jsonStorageError } from "../_lib/http.js";
import { isAuthorized } from "../_lib/security.js";
import { readReports, upsertReports } from "../_lib/reports.js";

function filterPublicReports(reports) {
  return (Array.isArray(reports) ? reports : []).filter((report) => {
    const status = String(report?.status || "").trim().toLowerCase();
    return status !== "hidden";
  });
}

function getPayloadReports(payload) {
  return Array.isArray(payload?.reports)
    ? payload.reports
    : Array.isArray(payload)
    ? payload
    : [];
}

export async function onRequest(context) {
  const { request, env } = context;
  const preflight = handleOptions(request);

  if (preflight) {
    return preflight;
  }

  if (request.method === "GET") {
    const scope = String(new URL(request.url).searchParams.get("scope") || "").trim().toLowerCase();

    try {
      if (scope === "public") {
        const reports = await readReports(env);
        return json({ reports: filterPublicReports(reports) });
      }

      if (scope === "recent") {
        if (!isAuthorized(request, env)) {
          return json({ error: "Unauthorized." }, { status: 401 });
        }

        return json({ reports: await readReports(env) });
      }

      if (isAuthorized(request, env)) {
        return json({ reports: await readReports(env) });
      }

      const reports = await readReports(env);
      return json({ reports: filterPublicReports(reports) });
    } catch (error) {
      return jsonStorageError(error, "Storage is rate limited. Reports are temporarily unavailable.");
    }
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

  try {
    const incoming = getPayloadReports(payload);
    const reports = await upsertReports(env, incoming);
    return json({ ok: true, reports }, { status: 201 });
  } catch (error) {
    return jsonStorageError(error, "Storage is rate limited. Report write failed.");
  }
}
