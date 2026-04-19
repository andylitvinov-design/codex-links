const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function normalizeText(value, max = 400) {
  return String(value || "").trim().slice(0, max);
}

function encodeHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function encodeUtf8(value) {
  return new TextEncoder().encode(String(value || ""));
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", encodeUtf8(value));
  return encodeHex(new Uint8Array(digest));
}

async function hmacSha256Hex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encodeUtf8(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, encodeUtf8(value));
  return encodeHex(new Uint8Array(digest));
}

export function getTrustedCloudBridgeLabel(config = {}) {
  return normalizeText(config?.CLOUD_BRIDGE_LABEL, 120) || "Trusted Codex Cloud";
}

export function isTrustedCloudBridgeConfigured(config = {}) {
  return Boolean(
    normalizeText(config?.CLOUD_BRIDGE_BASE_URL)
    && normalizeText(config?.CLOUD_BRIDGE_SHARED_SECRET, 300)
  );
}

export function getTrustedCloudBridgeTimeoutMs(config = {}) {
  const parsed = Number(normalizeText(config?.CLOUD_BRIDGE_REQUEST_TIMEOUT_MS, 20));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

export async function createTrustedCloudBridgeHeaders(method, url, body, secret, timestamp = new Date().toISOString()) {
  const normalizedMethod = normalizeText(method, 16).toUpperCase() || "POST";
  const bodyText = typeof body === "string" ? body : JSON.stringify(body || {});
  const bodyHash = await sha256Hex(bodyText);
  const canonical = [
    normalizedMethod,
    new URL(url).pathname,
    timestamp,
    bodyHash
  ].join("\n");
  const signature = await hmacSha256Hex(secret, canonical);

  return {
    "content-type": "application/json",
    accept: "application/json",
    "x-codex-bridge-timestamp": timestamp,
    "x-codex-bridge-signature": signature,
    "x-codex-bridge-body-sha256": bodyHash
  };
}

export async function submitTrustedCloudCommand(config, command) {
  if (!isTrustedCloudBridgeConfigured(config)) {
    return {
      ok: false,
      retryable: true,
      error: {
        code: "cloud_bridge_not_configured",
        message: "Trusted cloud bridge is not configured."
      }
    };
  }

  const baseUrl = normalizeText(config?.CLOUD_BRIDGE_BASE_URL, 400).replace(/\/+$/, "");
  const targetUrl = `${baseUrl}/v1/commands`;
  const payload = {
    command
  };
  const bodyText = JSON.stringify(payload);
  const headers = await createTrustedCloudBridgeHeaders(
    "POST",
    targetUrl,
    bodyText,
    normalizeText(config?.CLOUD_BRIDGE_SHARED_SECRET, 300)
  );

  let response;
  let data = null;

  try {
    response = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: bodyText,
      signal: AbortSignal.timeout(getTrustedCloudBridgeTimeoutMs(config))
    });
    data = await response.json().catch(() => null);
  } catch (error) {
    return {
      ok: false,
      retryable: true,
      error: {
        code: "cloud_bridge_request_failed",
        message: error instanceof Error ? error.message : String(error || "Bridge request failed.")
      }
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      retryable: response.status >= 500 || response.status === 429,
      error: {
        code: "cloud_bridge_rejected",
        message: normalizeText(data?.error || data?.message || `Trusted cloud bridge returned HTTP ${response.status}.`, 240)
      }
    };
  }

  return {
    ok: true,
    jobId: normalizeText(data?.jobId, 160),
    acceptedAt: normalizeText(data?.acceptedAt, 80),
    progressMessage: normalizeText(data?.progressMessage, 240)
  };
}

export function isTrustedCloudBridgeTimestampFresh(timestamp) {
  const parsed = Date.parse(String(timestamp || "").trim());

  if (!Number.isFinite(parsed)) {
    return false;
  }

  return Math.abs(Date.now() - parsed) <= MAX_CLOCK_SKEW_MS;
}
