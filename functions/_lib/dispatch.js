export const DISPATCH_MODE_LOCAL = "local-bridge";
export const DISPATCH_MODE_SLACK = "slack-codex-cloud";

function hasSlackToken(env) {
  return Boolean(String(env?.SLACK_BOT_TOKEN || "").trim());
}

function hasSlackChannel(env) {
  return Boolean(String(env?.SLACK_CODEX_CHANNEL_ID || "").trim());
}

export function normalizeDispatchMode(rawMode) {
  const mode = String(rawMode || "").trim().toLowerCase();

  if (mode === DISPATCH_MODE_SLACK) {
    return DISPATCH_MODE_SLACK;
  }

  return DISPATCH_MODE_LOCAL;
}

export function isSlackDispatchConfigured(env) {
  return hasSlackToken(env) && hasSlackChannel(env);
}

export function isSlackInboundConfigured(env) {
  return isSlackDispatchConfigured(env) && Boolean(String(env?.SLACK_SIGNING_SECRET || "").trim());
}

export function getConfiguredDispatchMode(env) {
  const explicit = normalizeDispatchMode(env?.COMMAND_DISPATCH_MODE);

  if (String(env?.COMMAND_DISPATCH_MODE || "").trim()) {
    return explicit;
  }

  if (isSlackDispatchConfigured(env)) {
    return DISPATCH_MODE_SLACK;
  }

  return DISPATCH_MODE_LOCAL;
}

export function getDispatchModeLabel(mode) {
  return normalizeDispatchMode(mode) === DISPATCH_MODE_SLACK
    ? "Codex Cloud via Slack"
    : "Local bridge fallback";
}

export function getSlackCodexMention(env) {
  const userId = String(env?.SLACK_CODEX_USER_ID || "").trim();

  if (userId) {
    return `<@${userId}>`;
  }

  const raw = String(env?.SLACK_CODEX_MENTION || "@Codex").trim();
  return raw || "@Codex";
}
