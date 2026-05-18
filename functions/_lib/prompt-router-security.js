const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._\-+/=]+/gi,
  /(Authorization\s*[:=]\s*)[^\n\r]+/gi,
  /(x-[a-z0-9-]*token\s*[:=]\s*)[^\n\r]+/gi,
  /((?:OPENAI|SLACK|GITHUB|VERCEL|PAYPAL|GOOGLE|ADMIN|LINKS)[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\s*[:=]\s*)[^\n\r]+/gi,
  /(-----BEGIN [^-]+PRIVATE KEY-----)[\s\S]*?(-----END [^-]+PRIVATE KEY-----)/gi,
  /([A-Za-z0-9_]*PRIVATE_KEY\s*[:=]\s*)[^\n\r]+/gi,
  /(cookie\s*[:=]\s*)[^\n\r]+/gi,
  /(password\s*[:=]\s*)[^\n\r]+/gi,
  /(client_secret\s*[:=]\s*)[^\n\r]+/gi,
  /(refresh_token\s*[:=]\s*)[^\n\r]+/gi,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /xox[baprs]-[A-Za-z0-9-]+/g,
  /gh[pousr]_[A-Za-z0-9_]{20,}/g
];

export function redactSecrets(value) {
  let text = typeof value === "string" ? value : JSON.stringify(value ?? "", null, 2);

  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, (match, prefix, suffix) => {
      if (suffix) {
        return `${prefix}\n[REDACTED_SECRET]\n${suffix}`;
      }

      if (prefix) {
        return `${prefix}[REDACTED_SECRET]`;
      }

      return "[REDACTED_SECRET]";
    });
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
