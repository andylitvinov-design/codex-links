import { CONFIG_STORAGE_KEY } from "./constants.js";

function normalizeValue(value, max = 400) {
  return String(value || "").trim().slice(0, max);
}

function normalizeConfig(input) {
  const source = input && typeof input === "object" ? input : {};

  return {
    COMMAND_DISPATCH_MODE: normalizeValue(source.COMMAND_DISPATCH_MODE, 80),
    GITHUB_OWNER: normalizeValue(source.GITHUB_OWNER, 120),
    GITHUB_TOKEN: normalizeValue(source.GITHUB_TOKEN, 300),
    OPENAI_API_KEY: normalizeValue(source.OPENAI_API_KEY, 300),
    PUBLIC_GA4_DEBUG_MODE: normalizeValue(source.PUBLIC_GA4_DEBUG_MODE, 20),
    PUBLIC_GA4_MEASUREMENT_ID: normalizeValue(source.PUBLIC_GA4_MEASUREMENT_ID, 40),
    SLACK_BOT_TOKEN: normalizeValue(source.SLACK_BOT_TOKEN, 300),
    SLACK_SIGNING_SECRET: normalizeValue(source.SLACK_SIGNING_SECRET, 300),
    SLACK_CODEX_CHANNEL_ID: normalizeValue(source.SLACK_CODEX_CHANNEL_ID, 120),
    SLACK_CODEX_USER_ID: normalizeValue(source.SLACK_CODEX_USER_ID, 120),
    SLACK_CODEX_MENTION: normalizeValue(source.SLACK_CODEX_MENTION, 120),
    SLACK_ACTOR_ACTIVITY_FRESHNESS_MS: normalizeValue(source.SLACK_ACTOR_ACTIVITY_FRESHNESS_MS, 40)
  };
}

function mergeConfig(stored, env) {
  const base = normalizeConfig(stored);

  return normalizeConfig({
    ...base,
    COMMAND_DISPATCH_MODE: env?.COMMAND_DISPATCH_MODE || base.COMMAND_DISPATCH_MODE,
    GITHUB_OWNER: env?.GITHUB_OWNER || base.GITHUB_OWNER,
    GITHUB_TOKEN: env?.GITHUB_TOKEN || base.GITHUB_TOKEN,
    OPENAI_API_KEY: env?.OPENAI_API_KEY || base.OPENAI_API_KEY,
    PUBLIC_GA4_DEBUG_MODE: env?.PUBLIC_GA4_DEBUG_MODE || base.PUBLIC_GA4_DEBUG_MODE,
    PUBLIC_GA4_MEASUREMENT_ID: env?.PUBLIC_GA4_MEASUREMENT_ID || base.PUBLIC_GA4_MEASUREMENT_ID,
    SLACK_BOT_TOKEN: env?.SLACK_BOT_TOKEN || base.SLACK_BOT_TOKEN,
    SLACK_SIGNING_SECRET: env?.SLACK_SIGNING_SECRET || base.SLACK_SIGNING_SECRET,
    SLACK_CODEX_CHANNEL_ID: env?.SLACK_CODEX_CHANNEL_ID || base.SLACK_CODEX_CHANNEL_ID,
    SLACK_CODEX_USER_ID: env?.SLACK_CODEX_USER_ID || base.SLACK_CODEX_USER_ID,
    SLACK_CODEX_MENTION: env?.SLACK_CODEX_MENTION || base.SLACK_CODEX_MENTION,
    SLACK_ACTOR_ACTIVITY_FRESHNESS_MS: env?.SLACK_ACTOR_ACTIVITY_FRESHNESS_MS || base.SLACK_ACTOR_ACTIVITY_FRESHNESS_MS
  });
}

function mask(value) {
  const normalized = normalizeValue(value);

  if (!normalized) {
    return "";
  }

  if (normalized.length <= 8) {
    return "set";
  }

  return `${normalized.slice(0, 4)}…${normalized.slice(-4)}`;
}

export async function readStoredConfig(env) {
  const raw = await env.LINKS_STORE.get(CONFIG_STORAGE_KEY, "json");
  return normalizeConfig(raw);
}

export async function readRuntimeConfig(env) {
  const stored = await readStoredConfig(env);
  return mergeConfig(stored, env);
}

export async function writeStoredConfig(env, input) {
  const next = normalizeConfig(input);
  await env.LINKS_STORE.put(CONFIG_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export async function updateStoredConfig(env, input) {
  const current = await readStoredConfig(env);
  const next = normalizeConfig({
    ...current,
    ...(input && typeof input === "object" ? input : {})
  });
  await env.LINKS_STORE.put(CONFIG_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function describeConfig(config) {
  const normalized = normalizeConfig(config);

  return {
    COMMAND_DISPATCH_MODE: normalized.COMMAND_DISPATCH_MODE || "",
    GITHUB_OWNER: normalized.GITHUB_OWNER || "",
    GITHUB_TOKEN: mask(normalized.GITHUB_TOKEN),
    OPENAI_API_KEY: mask(normalized.OPENAI_API_KEY),
    PUBLIC_GA4_DEBUG_MODE: normalized.PUBLIC_GA4_DEBUG_MODE || "",
    PUBLIC_GA4_MEASUREMENT_ID: normalized.PUBLIC_GA4_MEASUREMENT_ID || "",
    SLACK_BOT_TOKEN: mask(normalized.SLACK_BOT_TOKEN),
    SLACK_SIGNING_SECRET: mask(normalized.SLACK_SIGNING_SECRET),
    SLACK_CODEX_CHANNEL_ID: mask(normalized.SLACK_CODEX_CHANNEL_ID),
    SLACK_CODEX_USER_ID: mask(normalized.SLACK_CODEX_USER_ID),
    SLACK_CODEX_MENTION: normalized.SLACK_CODEX_MENTION || "",
    SLACK_ACTOR_ACTIVITY_FRESHNESS_MS: normalized.SLACK_ACTOR_ACTIVITY_FRESHNESS_MS || ""
  };
}

export function describePublicConfig(config) {
  const normalized = normalizeConfig(config);

  return {
    analytics: {
      ga4DebugMode: normalized.PUBLIC_GA4_DEBUG_MODE === "1" || normalized.PUBLIC_GA4_DEBUG_MODE.toLowerCase() === "true",
      ga4MeasurementId: normalized.PUBLIC_GA4_MEASUREMENT_ID || ""
    }
  };
}
