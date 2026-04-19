import crypto from "node:crypto";

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function normalizeText(value, max = 400) {
  return String(value || "").trim().slice(0, max);
}

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

export function buildBridgeCanonicalString(method, path, timestamp, bodySha256) {
  return [
    normalizeText(method, 16).toUpperCase() || "POST",
    normalizeText(path, 400) || "/",
    normalizeText(timestamp, 80),
    normalizeText(bodySha256, 80)
  ].join("\n");
}

export function signBridgeRequest(secret, { method, path, timestamp, bodySha256 }) {
  return crypto
    .createHmac("sha256", normalizeText(secret, 300))
    .update(buildBridgeCanonicalString(method, path, timestamp, bodySha256), "utf8")
    .digest("hex");
}

export function isBridgeTimestampFresh(timestamp) {
  const parsed = Date.parse(String(timestamp || "").trim());

  if (!Number.isFinite(parsed)) {
    return false;
  }

  return Math.abs(Date.now() - parsed) <= MAX_CLOCK_SKEW_MS;
}

export function verifyBridgeRequestSignature({ secret, method, path, timestamp, bodyText, signature, bodySha256 }) {
  if (!normalizeText(secret, 300)) {
    return { ok: false, error: "Shared secret is not configured." };
  }

  if (!isBridgeTimestampFresh(timestamp)) {
    return { ok: false, error: "Request timestamp is stale." };
  }

  const expectedBodySha = sha256Hex(bodyText);

  if (expectedBodySha !== String(bodySha256 || "").trim()) {
    return { ok: false, error: "Request body hash does not match." };
  }

  const expectedSignature = signBridgeRequest(secret, {
    method,
    path,
    timestamp,
    bodySha256: expectedBodySha
  });

  const provided = Buffer.from(String(signature || "").trim(), "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");

  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return { ok: false, error: "Request signature is invalid." };
  }

  return { ok: true };
}
