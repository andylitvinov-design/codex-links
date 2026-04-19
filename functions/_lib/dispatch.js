export const DISPATCH_MODE_LOCAL = "local-bridge";
export const DISPATCH_MODE_CLOUD = "cloud";
export const LEGACY_DISPATCH_MODE_SLACK = "slack-codex-cloud";
export const DISPATCH_MODE_SLACK = LEGACY_DISPATCH_MODE_SLACK;
export const CONFIG_DISPATCH_MODE_SLACK = "cloud-via-slack";
export const CONFIG_DISPATCH_MODE_DIRECT = "direct-openai";

function hasOpenAiKey(env) {
  return Boolean(String(env?.OPENAI_API_KEY || "").trim());
}

function hasSlackToken(env) {
  return Boolean(String(env?.SLACK_BOT_TOKEN || "").trim());
}

function hasSlackChannel(env) {
  return Boolean(String(env?.SLACK_CODEX_CHANNEL_ID || "").trim());
}

export function normalizeDispatchMode(rawMode) {
  const mode = String(rawMode || "").trim().toLowerCase();

  if (
    mode === DISPATCH_MODE_SLACK
    || mode === LEGACY_DISPATCH_MODE_SLACK
    || mode === CONFIG_DISPATCH_MODE_SLACK
  ) {
    return DISPATCH_MODE_SLACK;
  }

  if (mode === DISPATCH_MODE_CLOUD || mode === CONFIG_DISPATCH_MODE_DIRECT) {
    return DISPATCH_MODE_CLOUD;
  }

  return DISPATCH_MODE_LOCAL;
}

export function isCloudDispatchConfigured(env) {
  return hasOpenAiKey(env);
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
    if (explicit === DISPATCH_MODE_SLACK) {
      return isSlackDispatchConfigured(env) ? DISPATCH_MODE_SLACK : DISPATCH_MODE_LOCAL;
    }

    if (explicit === DISPATCH_MODE_CLOUD) {
      if (isCloudDispatchConfigured(env)) {
        return DISPATCH_MODE_CLOUD;
      }

      if (isSlackDispatchConfigured(env)) {
        return DISPATCH_MODE_SLACK;
      }

      return DISPATCH_MODE_LOCAL;
    }

    return explicit;
  }

  if (isSlackDispatchConfigured(env)) {
    return DISPATCH_MODE_SLACK;
  }

  if (isCloudDispatchConfigured(env)) {
    return DISPATCH_MODE_CLOUD;
  }

  return DISPATCH_MODE_LOCAL;
}

export function getDispatchModeLabel(mode) {
  const normalized = normalizeDispatchMode(mode);

  if (normalized === DISPATCH_MODE_SLACK) {
    return "Codex Cloud via Slack";
  }

  if (normalized === DISPATCH_MODE_CLOUD) {
    return "Direct OpenAI cloud";
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
