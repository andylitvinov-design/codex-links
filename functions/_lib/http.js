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

export function isStorageRateLimited(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("429")
    && (message.includes("workers kv") || message.includes("kv"))
    && (message.includes("limit") || message.includes("rate"));
}

export function jsonStorageError(error, fallbackMessage = "Storage temporarily rate limited.") {
  const rateLimited = isStorageRateLimited(error);

  return json({
    error: rateLimited ? "rate_limited" : "storage_error",
    message: rateLimited ? fallbackMessage : String(error?.message || fallbackMessage),
    rateLimited
  }, {
    status: rateLimited ? 429 : 500
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
