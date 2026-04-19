export const DISPATCH_MODE_LOCAL = "local-bridge";
export const DISPATCH_MODE_CLOUD = "cloud";
export const LEGACY_DISPATCH_MODE_SLACK = "slack-codex-cloud";
export const DISPATCH_MODE_SLACK = LEGACY_DISPATCH_MODE_SLACK;
export const CONFIG_DISPATCH_MODE_SLACK = "cloud-via-slack";
export const CONFIG_DISPATCH_MODE_DIRECT = "direct-openai";

function hasTrustedCloudBridgeBaseUrl(env) {
  return Boolean(String(env?.CLOUD_BRIDGE_BASE_URL || "").trim());
}

function hasTrustedCloudBridgeSecret(env) {
  return Boolean(String(env?.CLOUD_BRIDGE_SHARED_SECRET || "").trim());
}

export function normalizeDispatchMode(rawMode) {
  const mode = String(rawMode || "").trim().toLowerCase();

  if (mode === DISPATCH_MODE_SLACK || mode === LEGACY_DISPATCH_MODE_SLACK) {
    return DISPATCH_MODE_SLACK;
  }

  if (
    mode === DISPATCH_MODE_CLOUD
    || mode === CONFIG_DISPATCH_MODE_DIRECT
    || mode === CONFIG_DISPATCH_MODE_SLACK
  ) {
    return DISPATCH_MODE_CLOUD;
  }

  return DISPATCH_MODE_LOCAL;
}

export function isCloudDispatchConfigured(env) {
  return hasTrustedCloudBridgeBaseUrl(env) && hasTrustedCloudBridgeSecret(env);
}

export function isSlackDispatchConfigured(env) {
  return false;
}

export function isSlackInboundConfigured(env) {
  return false;
}

export function getConfiguredDispatchMode(env) {
  const explicit = normalizeDispatchMode(env?.COMMAND_DISPATCH_MODE);

  if (String(env?.COMMAND_DISPATCH_MODE || "").trim()) {
    if (explicit === DISPATCH_MODE_CLOUD) {
      return isCloudDispatchConfigured(env) ? DISPATCH_MODE_CLOUD : DISPATCH_MODE_LOCAL;
    }

    return explicit;
  }

  if (isCloudDispatchConfigured(env)) {
    return DISPATCH_MODE_CLOUD;
  }

  return DISPATCH_MODE_LOCAL;
}

export function getDispatchModeLabel(mode) {
  const normalized = normalizeDispatchMode(mode);

  if (normalized === DISPATCH_MODE_SLACK) {
    return "Legacy Codex Cloud via Slack";
  }

  if (normalized === DISPATCH_MODE_CLOUD) {
    return "Trusted Codex Cloud";
  }

  return "Local bridge";
}

export function getSlackCodexMention(env) {
  const userId = String(env?.SLACK_CODEX_USER_ID || "").trim();

  if (userId) {
    return `<@${userId}>`;
  }

  const raw = String(env?.SLACK_CODEX_MENTION || "@Codex").trim();
  return raw || "@Codex";
}
