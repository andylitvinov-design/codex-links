const PREFIX_SECRET_PATTERNS = [
  /(Authorization\s*[:=]\s*)[^\n\r]+/gi,
  /(x-[a-z0-9-]*token\s*[:=]\s*)[^\n\r]+/gi,
  /((?:OPENAI|SLACK|GITHUB|VERCEL|PAYPAL|GOOGLE|ADMIN|LINKS)[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\s*[:=]\s*)[^\n\r]+/gi,
  /([A-Za-z0-9_]*PRIVATE_KEY\s*[:=]\s*)[^\n\r]+/gi,
  /(cookie\s*[:=]\s*)[^\n\r]+/gi,
  /(password\s*[:=]\s*)[^\n\r]+/gi,
  /(client_secret\s*[:=]\s*)[^\n\r]+/gi,
  /(refresh_token\s*[:=]\s*)[^\n\r]+/gi
];

const FULL_SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._\-+/=]+/gi,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /xox[baprs]-[A-Za-z0-9-]+/g,
  /gh[pousr]_[A-Za-z0-9_]{20,}/g
];

const PRIVATE_KEY_PATTERN = /(-----BEGIN [^-]+PRIVATE KEY-----)[\s\S]*?(-----END [^-]+PRIVATE KEY-----)/gi;

export function redactSecrets(value) {
  let text = typeof value === "string" ? value : JSON.stringify(value ?? "", null, 2);

  text = text.replace(PRIVATE_KEY_PATTERN, "$1\n[REDACTED_SECRET]\n$2");

  for (const pattern of PREFIX_SECRET_PATTERNS) {
    text = text.replace(pattern, "$1[REDACTED_SECRET]");
  }

  for (const pattern of FULL_SECRET_PATTERNS) {
    text = text.replace(pattern, "[REDACTED_SECRET]");
  }

  return text;
}

export function getSafePromptMetadata(payload = {}) {
  return {
    project: String(payload.project || "").slice(0, 80),
    repo: String(payload.repo || "").slice(0, 160),
    category: String(payload.category || "").slice(0, 80),
    target: String(payload.target || "").slice(0, 40),
    promptLength: String(payload.prompt || "").length,
    hasLiveUrl: Boolean(String(payload.liveUrl || "").trim())
  };
}
