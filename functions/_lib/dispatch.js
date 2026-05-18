export const DISPATCH_MODE_LOCAL = "local-bridge";
export const DISPATCH_MODE_CLOUD = "cloud";
export const LEGACY_DISPATCH_MODE_SLACK = "slack-codex-cloud";
export const DISPATCH_MODE_SLACK = LEGACY_DISPATCH_MODE_SLACK;
export const DISPATCH_MODE_CLAUDE = "claude-bridge";
export const DISPATCH_MODE_CODE_COPILOT = "code-copilot-bridge";
export const CONFIG_DISPATCH_MODE_SLACK = "cloud-via-slack";
export const CONFIG_DISPATCH_MODE_DIRECT = "direct-openai";
export const EXECUTOR_ROUTE_BRIDGE = "bridge";
export const EXECUTOR_ROUTE_CLOUD_SLACK = "cloud-via-slack";
export const EXECUTOR_ROUTE_DIRECT_OPENAI = "direct-openai";
export const EXECUTOR_ROUTE_CLAUDE = "claude";
export const EXECUTOR_ROUTE_CODE_COPILOT = "code-copilot";

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

  if (mode === DISPATCH_MODE_CLAUDE || mode === EXECUTOR_ROUTE_CLAUDE) {
    return DISPATCH_MODE_CLAUDE;
  }

  if (mode === DISPATCH_MODE_CODE_COPILOT || mode === EXECUTOR_ROUTE_CODE_COPILOT) {
    return DISPATCH_MODE_CODE_COPILOT;
  }

  return DISPATCH_MODE_LOCAL;
}

export function normalizeExecutorRoute(rawMode, fallback = EXECUTOR_ROUTE_BRIDGE) {
  const mode = String(rawMode || "").trim().toLowerCase();

  if (
    mode === EXECUTOR_ROUTE_CLOUD_SLACK
    || mode === CONFIG_DISPATCH_MODE_SLACK
    || mode === DISPATCH_MODE_SLACK
  ) {
    return EXECUTOR_ROUTE_CLOUD_SLACK;
  }

  if (
    mode === EXECUTOR_ROUTE_DIRECT_OPENAI
    || mode === CONFIG_DISPATCH_MODE_DIRECT
    || mode === DISPATCH_MODE_CLOUD
  ) {
    return EXECUTOR_ROUTE_DIRECT_OPENAI;
  }

  if (mode === EXECUTOR_ROUTE_CLAUDE || mode === DISPATCH_MODE_CLAUDE) {
    return EXECUTOR_ROUTE_CLAUDE;
  }

  if (mode === EXECUTOR_ROUTE_CODE_COPILOT || mode === DISPATCH_MODE_CODE_COPILOT) {
    return EXECUTOR_ROUTE_CODE_COPILOT;
  }

  if (mode === EXECUTOR_ROUTE_BRIDGE || mode === DISPATCH_MODE_LOCAL) {
    return EXECUTOR_ROUTE_BRIDGE;
  }

  return fallback;
}

export function executorRouteToDispatchMode(route) {
  const normalized = normalizeExecutorRoute(route);

  if (normalized === EXECUTOR_ROUTE_CLOUD_SLACK) {
    return DISPATCH_MODE_SLACK;
  }

  if (normalized === EXECUTOR_ROUTE_DIRECT_OPENAI) {
    return DISPATCH_MODE_CLOUD;
  }

  if (normalized === EXECUTOR_ROUTE_CLAUDE) {
    return DISPATCH_MODE_CLAUDE;
  }

  if (normalized === EXECUTOR_ROUTE_CODE_COPILOT) {
    return DISPATCH_MODE_CODE_COPILOT;
  }

  return DISPATCH_MODE_LOCAL;
}

export function dispatchModeToExecutorRoute(mode) {
  const normalized = normalizeDispatchMode(mode);

  if (normalized === DISPATCH_MODE_SLACK) {
    return EXECUTOR_ROUTE_CLOUD_SLACK;
  }

  if (normalized === DISPATCH_MODE_CLOUD) {
    return EXECUTOR_ROUTE_DIRECT_OPENAI;
  }

  if (normalized === DISPATCH_MODE_CLAUDE) {
    return EXECUTOR_ROUTE_CLAUDE;
  }

  if (normalized === DISPATCH_MODE_CODE_COPILOT) {
    return EXECUTOR_ROUTE_CODE_COPILOT;
  }

  return EXECUTOR_ROUTE_BRIDGE;
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
    if (explicit === DISPATCH_MODE_CLAUDE) {
      return DISPATCH_MODE_CLAUDE;
    }

    if (explicit === DISPATCH_MODE_CODE_COPILOT) {
      return DISPATCH_MODE_CODE_COPILOT;
    }

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

  if (normalized === DISPATCH_MODE_CLAUDE) {
    return "Claude Code bridge";
  }

  if (normalized === DISPATCH_MODE_CODE_COPILOT) {
    return "Code Copilot bridge";
  }

  return "Local bridge";
}

export function getExecutorRouteLabel(route) {
  const normalized = normalizeExecutorRoute(route);

  if (normalized === EXECUTOR_ROUTE_CLOUD_SLACK) {
    return "Codex Cloud via Slack";
  }

  if (normalized === EXECUTOR_ROUTE_DIRECT_OPENAI) {
    return "Direct OpenAI cloud";
  }

  if (normalized === EXECUTOR_ROUTE_CLAUDE) {
    return "Claude Code bridge";
  }

  if (normalized === EXECUTOR_ROUTE_CODE_COPILOT) {
    return "Code Copilot bridge";
  }

  return "Local bridge";
}

export function getSlackCodexMention(env) {
  const userId = String(env?.SLACK_CODEX_USER_ID || "").trim();

  if (userId) {
    return `<@${userId}>`;
  }

  const raw = String(env?.SLACK_CODEX_MENTION || "@Codex").trim();

  if (raw) {
    return raw;
  }

  return "@Codex";
}