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

export function text(body, init = {}) {
  return new Response(body, {
    ...init,
    headers: {
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
