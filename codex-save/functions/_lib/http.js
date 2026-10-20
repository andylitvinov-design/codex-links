import { JSON_HEADERS } from "./constants.js";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "Content-Type, X-Write-Token",
  "cache-control": "no-store, no-cache, must-revalidate"
};

export function json(data, init = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...CORS_HEADERS,
      ...(init.headers || {})
    }
  });
}

export function handleOptions(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS
    });
  }

  return null;
}

export function isWriteAuthorized(request, env = {}) {
  const provided = String(request?.headers?.get?.("x-write-token") || "").trim();
  const accepted = [env.LINKS_WRITE_TOKEN, env.ADMIN_TOKEN]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return Boolean(provided) && accepted.includes(provided);
}
