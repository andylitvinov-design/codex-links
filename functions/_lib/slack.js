import { constantTimeEqual } from "./security.js";
import { createCommandError } from "./command-debug.js";
import { readThreads } from "./threads.js";
import { buildSlackCommandPrompt } from "./prompt-builder.js";

const encoder = new TextEncoder();
const DEFAULT_SLACK_API_TIMEOUT_MS = 15_000;
const SLACK_PHOTO_UPLOAD_RETRY_COUNT = 3;
const SLACK_PHOTO_UPLOAD_RETRY_DELAY_MS = 1_500;
const DEFAULT_SLACK_ACTOR_PROBE_TIMEOUT_MS = 30_000;
const DEFAULT_SLACK_ACTOR_PROBE_POLL_MS = 2_000;
const DEFAULT_SLACK_ACTOR_PROBE_COOLDOWN_MS = 30_000;
const DEFAULT_SLACK_ACTOR_ACTIVITY_FRESHNESS_MS = 15 * 60_000;
const DEFAULT_SLACK_ACTOR_VALIDATION_CACHE_TTL_MS = 5 * 60_000;
const SLACK_ACTOR_VALIDATION_CACHE_KEY_PREFIX = "slack_actor_validation_cache:";
const SLACK_ACTOR_PROBE_COOLDOWN_KEY_PREFIX = "slack_actor_probe_cooldown:";

function normalizeText(value) {
  return String(value || "").trim();
}

async function signSlackPayload(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const bytes = new Uint8Array(signature);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function buildSlackHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json; charset=utf-8"
  };
}

function buildSlackFormHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/x-www-form-urlencoded; charset=utf-8"
  };
}

function buildSlackAuthHeaders(token, headers = {}) {
  return {
    authorization: `Bearer ${token}`,
    ...headers
  };
}

function resolveSlackDispatchToken(env) {
  return normalizeText(env?.SLACK_CODEX_DISPATCH_TOKEN);
}

function normalizeSlackQueryTs(rawValue) {
  const value = normalizeText(rawValue);

  if (!value) {
    return "";
  }

  if (/^\d+(?:\.\d+)?$/.test(value)) {
    return value;
  }

  const parsed = Date.parse(value);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return "";
  }

  return String(parsed / 1000);
}

function withCommandError(error, input) {
  const wrapped = error instanceof Error ? error : new Error(String(error || "Slack request failed."))
  wrapped.commandError = createCommandError(input)
  return wrapped
}

export function getSlackApiTimeoutMs(env, fallback = DEFAULT_SLACK_API_TIMEOUT_MS) {
  const configured = Number(env?.SLACK_API_TIMEOUT_MS);

  if (!Number.isFinite(configured) || configured < 100) {
    return fallback;
  }

  return configured;
}

export function getSlackActorProbeTimeoutMs(env, fallback = DEFAULT_SLACK_ACTOR_PROBE_TIMEOUT_MS) {
  const configured = Number(env?.SLACK_ACTOR_PROBE_TIMEOUT_MS);

  if (!Number.isFinite(configured) || configured < 100) {
    return fallback;
  }

  return configured;
}

function getSlackActorProbePollMs(env, fallback = DEFAULT_SLACK_ACTOR_PROBE_POLL_MS) {
  const configured = Number(env?.SLACK_ACTOR_PROBE_POLL_MS);

  if (!Number.isFinite(configured) || configured < 1) {
    return fallback;
  }

  return configured;
}

function getSlackActorProbeCooldownMs(env, fallback = DEFAULT_SLACK_ACTOR_PROBE_COOLDOWN_MS) {
  const configured = Number(env?.SLACK_ACTOR_PROBE_COOLDOWN_MS);

  if (!Number.isFinite(configured) || configured < 1_000) {
    return fallback;
  }

  return configured;
}

function getSlackActorActivityFreshnessMs(env, fallback = DEFAULT_SLACK_ACTOR_ACTIVITY_FRESHNESS_MS) {
  const configured = Number(env?.SLACK_ACTOR_ACTIVITY_FRESHNESS_MS);

  if (!Number.isFinite(configured) || configured < 1_000) {
    return fallback;
  }

  return configured;
}

function getSlackActorValidationCacheTtlMs(env, fallback = DEFAULT_SLACK_ACTOR_VALIDATION_CACHE_TTL_MS) {
  const configured = Number(env?.SLACK_ACTOR_VALIDATION_CACHE_TTL_MS);

  if (!Number.isFinite(configured) || configured < 1_000) {
    return fallback;
  }

  return configured;
}

function isSlackActorLiveProbeEnabled(env, options = {}) {
  if (typeof options.liveProbe === "boolean") {
    return options.liveProbe;
  }

  const configured = normalizeText(env?.SLACK_ACTOR_LIVE_PROBE).toLowerCase();
  return configured === "1" || configured === "true" || configured === "yes" || configured === "on";
}

function getSlackActorValidationCacheKey(channel, targetUserId) {
  return `${SLACK_ACTOR_VALIDATION_CACHE_KEY_PREFIX}${normalizeText(channel)}:${normalizeText(targetUserId)}`;
}

function getSlackActorProbeCooldownKey(channel, targetUserId) {
  return `${SLACK_ACTOR_PROBE_COOLDOWN_KEY_PREFIX}${normalizeText(channel)}:${normalizeText(targetUserId)}`;
}

async function readSlackActorValidationCache(env, channel, targetUserId) {
  const store = env?.LINKS_STORE;

  if (!store?.get) {
    return null;
  }

  const cached = await store.get(getSlackActorValidationCacheKey(channel, targetUserId), "json").catch(() => null);

  if (!cached || typeof cached !== "object") {
    return null;
  }

  const normalized = buildSlackActorValidationResult(cached);
  const checkedAt = normalized.lastValidatedAt;

  if (
    !["validated", "unverified"].includes(normalized.validationStatus)
    || normalized.configuredUserId !== normalizeText(targetUserId)
    || !checkedAt
  ) {
    return null;
  }

  const ageMs = Date.now() - Date.parse(checkedAt);

  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > getSlackActorValidationCacheTtlMs(env)) {
    return null;
  }

  return normalized;
}

async function readSlackActorProbeCooldown(env, channel, targetUserId) {
  const store = env?.LINKS_STORE;

  if (!store?.get) {
    return null;
  }

  const cached = await store.get(getSlackActorProbeCooldownKey(channel, targetUserId), "json").catch(() => null);

  if (!cached || typeof cached !== "object") {
    return null;
  }

  const checkedAt = normalizeText(cached.checkedAt);
  const ageMs = Date.now() - Date.parse(checkedAt);

  if (!checkedAt || !Number.isFinite(ageMs) || ageMs < 0 || ageMs > getSlackActorProbeCooldownMs(env) + 5_000) {
    return null;
  }

  return buildSlackActorValidationResult({
    validationStatus: "unverified",
    code: "codex_target_actor_probe_cooling_down",
    message: "Slack actor validation probe is cooling down.",
    detail: "A recent live actor probe already ran. Suppressing a duplicate probe to avoid Slack spam; retry after the cooldown window.",
    configuredUserId: targetUserId,
    probeChannelId: cached.probeChannelId,
    probeMessageTs: cached.probeMessageTs,
    probeThreadTs: cached.probeThreadTs,
    lastValidatedAt: checkedAt
  });
}

async function writeSlackActorProbeCooldown(env, channel, targetUserId, input = {}) {
  const store = env?.LINKS_STORE;

  if (!store?.put) {
    return;
  }

  const cooldownMs = getSlackActorProbeCooldownMs(env);
  const jitterMs = Math.floor(Math.random() * Math.min(5_000, cooldownMs));
  const expirationTtl = Math.max(1, Math.ceil((cooldownMs + jitterMs) / 1000));

  await store.put(
    getSlackActorProbeCooldownKey(channel, targetUserId),
    JSON.stringify({
      checkedAt: new Date().toISOString(),
      probeChannelId: normalizeText(input.probeChannelId),
      probeMessageTs: normalizeText(input.probeMessageTs),
      probeThreadTs: normalizeText(input.probeThreadTs)
    }),
    { expirationTtl }
  ).catch(() => {});
}

async function writeSlackActorValidationCache(env, channel, targetUserId, result) {
  const store = env?.LINKS_STORE;

  if (!store?.put || !result || !["validated", "unverified"].includes(result.validationStatus)) {
    return;
  }

  const ttlMs = getSlackActorValidationCacheTtlMs(env);
  const expirationTtl = Math.max(1, Math.ceil(ttlMs / 1000));

  await store.put(
    getSlackActorValidationCacheKey(channel, targetUserId),
    JSON.stringify(buildSlackActorValidationResult(result)),
    { expirationTtl }
  ).catch(() => {});
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_SLACK_API_TIMEOUT_MS, label = "Slack request") {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");

    if (controller.signal.aborted || /abort/i.test(message)) {
      throw new Error(`${label} timed out after ${timeoutMs}ms.`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callSlackApi(token, method, body = null, query = null, options = {}) {
  const url = new URL(`https://slack.com/api/${method}`);

  if (query && typeof query === "object") {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim()) {
        url.searchParams.set(key, String(value));
      }
    });
  }

  const response = await fetchWithTimeout(url.toString(), {
    method: body ? "POST" : "GET",
    headers: buildSlackHeaders(token),
    body: body ? JSON.stringify(body) : undefined
  }, getSlackApiTimeoutMs(options.env || {}, options.timeoutMs), `Slack API ${method}`);
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || `Slack API ${method} failed with ${response.status}.`);
  }

  return data;
}

async function callSlackApiForm(token, method, body = null, query = null, options = {}) {
  const url = new URL(`https://slack.com/api/${method}`);

  if (query && typeof query === "object") {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim()) {
        url.searchParams.set(key, String(value));
      }
    });
  }

  const form = new URLSearchParams();

  if (body && typeof body === "object") {
    Object.entries(body).forEach(([key, value]) => {
      if (value === undefined || value === null) {
        return;
      }

      form.set(key, typeof value === "string" ? value : JSON.stringify(value));
    });
  }

  const response = await fetchWithTimeout(url.toString(), {
    method: "POST",
    headers: buildSlackFormHeaders(token),
    body: form
  }, getSlackApiTimeoutMs(options.env || {}, options.timeoutMs), `Slack API ${method}`);
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || `Slack API ${method} failed with ${response.status}.`);
  }

  return data;
}

function buildSlackActorValidationResult(input = {}) {
  return {
    validationStatus: normalizeText(input.validationStatus).toLowerCase() || "unverified",
    code: normalizeText(input.code),
    message: normalizeText(input.message),
    detail: normalizeText(input.detail),
    authTestOk: Boolean(input.authTestOk),
    channelMembershipOk: Boolean(input.channelMembershipOk),
    botUserId: normalizeText(input.botUserId),
    configuredUserId: normalizeText(input.configuredUserId),
    probeChannelId: normalizeText(input.probeChannelId),
    probeMessageTs: normalizeText(input.probeMessageTs),
    probeThreadTs: normalizeText(input.probeThreadTs || input.probeMessageTs),
    lastValidatedAt: normalizeText(input.lastValidatedAt),
    observedReply: input.observedReply && typeof input.observedReply === "object"
      ? {
          ts: normalizeText(input.observedReply.ts),
          threadTs: normalizeText(input.observedReply.threadTs || input.observedReply.thread_ts || input.observedReply.ts),
          text: normalizeText(input.observedReply.text),
          user: normalizeText(input.observedReply.user),
          botId: normalizeText(input.observedReply.botId || input.observedReply.bot_id),
          subtype: normalizeText(input.observedReply.subtype)
        }
      : null
  };
}

function decodeSlackDataUrl(dataUrl) {
  const value = normalizeText(dataUrl);
  const match = value.match(/^data:([^;,]+)?;base64,(.+)$/i);

  if (!match) {
    throw new Error("Photo payload is not a valid base64 data URL.");
  }

  const contentType = normalizeText(match[1]) || "application/octet-stream";
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return {
    bytes,
    contentType
  };
}

async function uploadSlackPhotoToThreadOnce(token, channel, threadTs, photo, options = {}) {
  if (!photo || typeof photo !== "object") {
    return null;
  }

  const fileName = normalizeText(photo.fileName) || "photo";
  const decoded = decodeSlackDataUrl(photo.dataUrl);
  const contentType = normalizeText(photo.contentType) || decoded.contentType;
  const length = Number(photo.size || decoded.bytes.byteLength || 0) || decoded.bytes.byteLength;
  const timeoutMs = getSlackApiTimeoutMs(options.env || {}, options.timeoutMs);
  const upload = await callSlackApiForm(token, "files.getUploadURLExternal", {
    filename: fileName,
    length
  }, null, { env: options.env, timeoutMs });

  const uploadResponse = await fetchWithTimeout(String(upload.upload_url || ""), {
    method: "POST",
    headers: buildSlackAuthHeaders(token, {
      "content-type": contentType,
      "content-length": String(length)
    }),
    body: decoded.bytes
  }, timeoutMs, "Slack file upload");

  if (!uploadResponse.ok) {
    throw new Error(`Slack file upload failed with ${uploadResponse.status}.`);
  }

  const completed = await callSlackApiForm(token, "files.completeUploadExternal", {
    files: [
      {
        id: normalizeText(upload.file_id),
        title: fileName
      }
    ],
    channel_id: channel,
    thread_ts: threadTs,
    initial_comment: "Attached image from Codex Links request."
  }, null, { env: options.env, timeoutMs });

  const completedFile = Array.isArray(completed?.files) ? completed.files[0] : null;
  let permalink = normalizeText(completedFile?.permalink || completedFile?.permalink_public);
  // url_private_download is a direct bot-token-authenticated URL Codex can curl.
  // files.completeUploadExternal sometimes omits it, so we fall back to files.info.
  let urlPrivateDownload = normalizeText(completedFile?.url_private_download || completedFile?.url_private);

  if (!permalink || !urlPrivateDownload) {
    try {
      const info = await callSlackApi(token, "files.info", null, {
        file: normalizeText(upload.file_id)
      }, { env: options.env, timeoutMs });
      permalink = permalink || normalizeText(info?.file?.permalink || info?.file?.permalink_public);
      urlPrivateDownload = urlPrivateDownload
        || normalizeText(info?.file?.url_private_download || info?.file?.url_private);
    } catch (error) {
      console.error("[codex-links][slack] files.info fallback failed", {
        fileId: normalizeText(upload.file_id),
        error: error instanceof Error ? error.message : String(error || "Unknown error")
      });
    }
  }

  return {
    fileId: normalizeText(upload.file_id),
    permalink,
    urlPrivateDownload,
    fileName,
    threadTs: normalizeText(threadTs),
    threaded: Boolean(normalizeText(threadTs))
  };
}

async function uploadSlackPhotoToThread(token, channel, threadTs, photo, options = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= SLACK_PHOTO_UPLOAD_RETRY_COUNT; attempt += 1) {
    try {
      return await uploadSlackPhotoToThreadOnce(token, channel, threadTs, photo, options);
    } catch (error) {
      lastError = error;

      if (attempt >= SLACK_PHOTO_UPLOAD_RETRY_COUNT) {
        break;
      }

      await sleep(SLACK_PHOTO_UPLOAD_RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Slack photo upload failed.");
}

async function postSlackThreadNudge(token, channel, threadTs, text, options = {}) {
  const value = normalizeText(text);

  if (!value) {
    return null;
  }

  return callSlackApi(token, "chat.postMessage", {
    channel,
    thread_ts: threadTs,
    text: value,
    mrkdwn: true,
    unfurl_links: false,
    unfurl_media: false
  }, null, {
    env: options.env,
    timeoutMs: options.timeoutMs
  });
}

export async function fetchSlackThreadReplies(env, channel, threadTs, options = {}) {
  const token = normalizeText(env?.SLACK_BOT_TOKEN);
  const normalizedChannel = normalizeText(channel);
  const normalizedThreadTs = normalizeText(threadTs);

  if (!token || !normalizedChannel || !normalizedThreadTs) {
    return [];
  }

  const data = await callSlackApi(token, "conversations.replies", null, {
    channel: normalizedChannel,
    ts: normalizedThreadTs,
    inclusive: true,
    limit: 100
  }, {
    env,
    timeoutMs: options.timeoutMs
  });

  return (Array.isArray(data?.messages) ? data.messages : [])
    .filter((message) => String(message?.ts || "").trim() && String(message?.thread_ts || message?.ts || "").trim() === normalizedThreadTs)
    .map((message) => ({
      ts: normalizeText(message?.ts),
      threadTs: normalizeText(message?.thread_ts || message?.ts),
      text: extractSlackMessageText(message),
      user: normalizeText(message?.user || message?.bot_profile?.user_id),
      botId: normalizeText(message?.bot_id || message?.botId),
      subtype: normalizeText(message?.subtype)
    }));
}

export async function fetchSlackChannelMessages(env, channel, options = {}) {
  const token = normalizeText(env?.SLACK_BOT_TOKEN);
  const normalizedChannel = normalizeText(channel);
  const oldest = normalizeSlackQueryTs(options.oldest);

  if (!token || !normalizedChannel) {
    return [];
  }

  const data = await callSlackApi(token, "conversations.history", null, {
    channel: normalizedChannel,
    inclusive: true,
    limit: 100,
    oldest
  }, {
    env,
    timeoutMs: options.timeoutMs
  });

  return (Array.isArray(data?.messages) ? data.messages : []).map((message) => ({
    ts: normalizeText(message?.ts),
    threadTs: normalizeText(message?.thread_ts || message?.ts),
    text: extractSlackMessageText(message),
    user: normalizeText(message?.user || message?.bot_profile?.user_id),
    botId: normalizeText(message?.bot_id || message?.botId),
    subtype: normalizeText(message?.subtype)
  }));
}

async function validateSlackTarget(token, channel, targetUserId) {
  const normalizedTarget = normalizeText(targetUserId);

  if (!normalizedTarget) {
    return buildSlackActorValidationResult({
      validationStatus: "invalid",
      code: "codex_target_actor_unverified",
      message: "Configured Slack target user is missing.",
      detail: "Set SLACK_CODEX_USER_ID to the real Codex Cloud Slack actor before using cloud via Slack."
    });
  }

  const auth = await callSlackApi(token, "auth.test", null, null, { env: { SLACK_API_TIMEOUT_MS: DEFAULT_SLACK_API_TIMEOUT_MS } });
  const botUserId = normalizeText(auth.user_id);

  if (botUserId && normalizedTarget === botUserId) {
    return buildSlackActorValidationResult({
      validationStatus: "invalid",
      code: "codex_target_user_invalid",
      message: "Configured Slack target user points to the Codex Links sender app.",
      detail: "Install the separate OpenAI Codex Slack app and set SLACK_CODEX_USER_ID to its @Codex bot/user ID, not the Codex Links sender app user returned by auth.test.",
      configuredUserId: normalizedTarget,
      authTestOk: true,
      botUserId
    });
  }

  const members = await callSlackApi(token, "conversations.members", null, { channel }, { env: { SLACK_API_TIMEOUT_MS: DEFAULT_SLACK_API_TIMEOUT_MS } });
  const memberIds = Array.isArray(members.members) ? members.members.map((value) => normalizeText(value)) : [];

  if (!memberIds.includes(normalizedTarget)) {
    return buildSlackActorValidationResult({
      validationStatus: "invalid",
      code: "codex_target_user_invalid",
      message: "Configured Slack target user is not in the dispatch channel.",
      detail: "Invite the target Codex user to SLACK_CODEX_CHANNEL_ID or update SLACK_CODEX_USER_ID.",
      configuredUserId: normalizedTarget,
      authTestOk: true,
      channelMembershipOk: false,
      botUserId
    });
  }

  return buildSlackActorValidationResult({
    validationStatus: "unverified",
    configuredUserId: normalizedTarget,
    authTestOk: true,
    channelMembershipOk: true,
    botUserId
  });
}

function buildSlackActorProbeText(targetUserId) {
  const mention = targetUserId ? `<@${targetUserId}>` : "@Codex";

  return [
    `${mention} Codex Links actor validation probe.`,
    "Reply in this thread with any short progress update to confirm you are the active Codex Cloud Slack worker for this route."
  ].join(" ");
}

export function parseSlackRepoAck(text) {
  const value = normalizeText(text, 4000);
  const line = value.split(/\r?\n/).map((entry) => entry.trim()).find((entry) => /^ACK\s+/i.test(entry));

  if (!line) {
    return null;
  }

  const result = {};
  const pattern = /\b(repo|project|command)=([^\s]+)/gi;
  let match;

  while ((match = pattern.exec(line)) !== null) {
    result[match[1].toLowerCase()] = normalizeText(match[2], 300);
  }

  if (!result.repo && !result.project && !result.command) {
    return null;
  }

  return {
    repo: result.repo || "",
    project: result.project || "",
    command: result.command || "",
    raw: line
  };
}

export function validateSlackRepoAck(command, ack) {
  if (!ack) {
    return {
      status: "warning",
      warning: "Missing repo ACK from Codex Cloud worker."
    };
  }

  const expectedRepo = normalizeText(command?.targetRepo);
  const expectedProject = normalizeText(command?.projectId || command?.threadId).toLowerCase();
  const expectedCommand = normalizeText(command?.id);
  const actualRepo = normalizeText(ack.repo);
  const actualProject = normalizeText(ack.project).toLowerCase();
  const actualCommand = normalizeText(ack.command);
  const mismatches = [];

  if (expectedRepo && actualRepo !== expectedRepo) {
    mismatches.push(`repo expected ${expectedRepo}, got ${actualRepo || "empty"}`);
  }

  if (expectedProject && actualProject !== expectedProject) {
    mismatches.push(`project expected ${expectedProject}, got ${actualProject || "empty"}`);
  }

  if (expectedCommand && actualCommand !== expectedCommand) {
    mismatches.push(`command expected ${expectedCommand}, got ${actualCommand || "empty"}`);
  }

  if (mismatches.length) {
    return {
      status: "warning",
      warning: `Repo ACK mismatch: ${mismatches.join("; ")}.`
    };
  }

  return {
    status: "validated",
    warning: ""
  };
}

function pickValidatedProbeReply(replies, targetUserId) {
  const normalizedTarget = normalizeText(targetUserId);
  const candidates = (Array.isArray(replies) ? replies : [])
    .filter((reply) => normalizeText(reply?.ts))
    .filter((reply) => normalizeText(reply?.text))
    .filter((reply) => !isIgnorableSlackReplyText(reply?.text))
    .filter((reply) => normalizeText(reply?.user) === normalizedTarget);

  return candidates.at(-1) || null;
}

function pickValidatedChannelActivity(messages, targetUserId) {
  const normalizedTarget = normalizeText(targetUserId);
  const candidates = (Array.isArray(messages) ? messages : [])
    .filter((message) => normalizeText(message?.ts))
    .filter((message) => normalizeText(message?.text))
    .filter((message) => !isIgnorableSlackReplyText(message?.text))
    .filter((message) => normalizeText(message?.user) === normalizedTarget);

  return candidates.at(0) || null;
}

export async function validateSlackCodexActor(env, options = {}) {
  const token = normalizeText(env?.SLACK_BOT_TOKEN);
  const channel = normalizeText(env?.SLACK_CODEX_CHANNEL_ID);
  const targetUserId = normalizeText(env?.SLACK_CODEX_USER_ID);
  const forceProbe = Boolean(options.forceProbe);

  if (!token || !channel) {
    return buildSlackActorValidationResult({
      validationStatus: "invalid",
      code: "slack_dispatch_failed",
      message: "Slack Codex dispatch is not configured.",
      detail: "Missing SLACK_BOT_TOKEN or SLACK_CODEX_CHANNEL_ID.",
      configuredUserId: targetUserId
    });
  }

  const cachedValidation = await readSlackActorValidationCache(env, channel, targetUserId);

  if (cachedValidation?.validationStatus === "validated" && !forceProbe) {
    return cachedValidation;
  }

  const membershipResult = await validateSlackTarget(token, channel, targetUserId);

  if (membershipResult.validationStatus === "invalid") {
    return membershipResult;
  }

  const recentChannelActivity = await fetchSlackChannelMessages(env, channel, {
    oldest: new Date(Date.now() - getSlackActorActivityFreshnessMs(env)).toISOString(),
    timeoutMs: options.timeoutMs
  });
  const recentActorActivity = pickValidatedChannelActivity(recentChannelActivity, targetUserId);

  if (recentActorActivity) {
    const result = buildSlackActorValidationResult({
      validationStatus: "validated",
      configuredUserId: targetUserId,
      lastValidatedAt: new Date().toISOString(),
      observedReply: recentActorActivity
    });
    await writeSlackActorValidationCache(env, channel, targetUserId, result);
    return result;
  }

  if (!isSlackActorLiveProbeEnabled(env, options)) {
    const result = buildSlackActorValidationResult({
      validationStatus: "unverified",
      code: "codex_target_actor_unverified",
      message: "Configured Slack target user has no recent confirmed activity.",
      detail: "Live actor probe is disabled. Dispatch can continue, but Slack actor verification remains unconfirmed until a real worker reply is observed.",
      configuredUserId: targetUserId,
      lastValidatedAt: new Date().toISOString()
    });
    await writeSlackActorValidationCache(env, channel, targetUserId, result);
    return result;
  }

  const probeCooldown = forceProbe ? null : await readSlackActorProbeCooldown(env, channel, targetUserId);

  if (probeCooldown) {
    return probeCooldown;
  }

  if (cachedValidation && !forceProbe) {
    return cachedValidation;
  }

  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Number(options.timeoutMs)
    : getSlackActorProbeTimeoutMs(env);
  const pollIntervalMs = Number.isFinite(Number(options.pollIntervalMs)) && Number(options.pollIntervalMs) > 0
    ? Number(options.pollIntervalMs)
    : getSlackActorProbePollMs(env);

  await writeSlackActorProbeCooldown(env, channel, targetUserId);

  const probeResponse = await callSlackApi(token, "chat.postMessage", {
    channel,
    text: buildSlackActorProbeText(targetUserId),
    unfurl_links: false,
    unfurl_media: false,
    mrkdwn: true
  }, null, {
    env,
    timeoutMs
  });
  const probeChannelId = normalizeText(probeResponse.channel) || channel;
  const probeMessageTs = normalizeText(probeResponse.ts);
  const probeThreadTs = normalizeText(probeResponse.message?.thread_ts || probeResponse.ts);
  await writeSlackActorProbeCooldown(env, channel, targetUserId, {
    probeChannelId,
    probeMessageTs,
    probeThreadTs
  });
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < timeoutMs) {
    const replies = await fetchSlackThreadReplies(env, probeChannelId, probeThreadTs, {
      timeoutMs
    });
    const validatedReply = pickValidatedProbeReply(
      replies.filter((reply) => normalizeText(reply.ts) !== probeMessageTs),
      targetUserId
    );

    if (validatedReply) {
      const result = buildSlackActorValidationResult({
        validationStatus: "validated",
        configuredUserId: targetUserId,
        probeChannelId,
        probeMessageTs,
        probeThreadTs,
        lastValidatedAt: new Date().toISOString(),
        observedReply: validatedReply
      });
      await writeSlackActorValidationCache(env, channel, targetUserId, result);
      return result;
    }

    await sleep(pollIntervalMs);
  }

  const result = buildSlackActorValidationResult({
    validationStatus: "unverified",
    code: "codex_target_actor_unverified",
    message: "Configured Slack target user did not acknowledge the live probe.",
    detail: "Slack membership is confirmed, but the target did not reply in-thread during the probe window. Dispatch can continue and will still fall back to bridge if no live Codex ack appears.",
    configuredUserId: targetUserId,
    probeChannelId,
    probeMessageTs,
    probeThreadTs,
    lastValidatedAt: new Date().toISOString()
  });

  await writeSlackActorValidationCache(env, channel, targetUserId, result);
  return result;
}

export async function runSlackActorDiagnostic(env, options = {}) {
  const startedAt = new Date().toISOString();
  try {
    const result = await validateSlackCodexActor(env, {
      ...options,
      liveProbe: true,
      forceProbe: true,
      timeoutMs: Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 10_000,
      pollIntervalMs: Number.isFinite(Number(options.pollIntervalMs)) ? Number(options.pollIntervalMs) : 1_000
    });
    const completedAt = new Date().toISOString();
    return {
      ok: result.validationStatus === "validated",
      startedAt,
      completedAt,
      validationStatus: result.validationStatus,
      code: result.code,
      message: result.message,
      detail: result.detail,
      authTestOk: Boolean(result.authTestOk || result.validationStatus !== "invalid"),
      channelMembershipOk: Boolean(result.channelMembershipOk || result.validationStatus !== "invalid"),
      botUserId: result.botUserId || "",
      targetUserId: result.configuredUserId || normalizeText(env?.SLACK_CODEX_USER_ID),
      channelId: normalizeText(env?.SLACK_CODEX_CHANNEL_ID),
      probeMessageTs: result.probeMessageTs || "",
      probeThreadTs: result.probeThreadTs || "",
      probeReplyTs: result.observedReply?.ts || "",
      observedReplyUser: result.observedReply?.user || ""
    };
  } catch (error) {
    return {
      ok: false,
      startedAt,
      completedAt: new Date().toISOString(),
      validationStatus: "invalid",
      code: "slack_actor_diagnostic_failed",
      message: "Slack actor diagnostic failed.",
      detail: error instanceof Error ? error.message : String(error || "Unknown Slack diagnostic error."),
      authTestOk: false,
      channelMembershipOk: false,
      targetUserId: normalizeText(env?.SLACK_CODEX_USER_ID),
      channelId: normalizeText(env?.SLACK_CODEX_CHANNEL_ID),
      probeMessageTs: "",
      probeThreadTs: "",
      probeReplyTs: "",
      observedReplyUser: ""
    };
  }
}

async function resolveStoredCodexThreadId(env, command) {
  const directThreadId = normalizeText(command?.threadId);

  if (/^(urn:uuid:)?[0-9a-fA-F-]{36}$/.test(directThreadId)) {
    return directThreadId;
  }

  const projectId = normalizeText(command?.projectId || command?.threadId).toLowerCase();
  const projectLabel = normalizeText(command?.projectLabel || command?.threadLabel).toLowerCase();

  if (!projectId && !projectLabel) {
    return "";
  }

  try {
    const threads = await readThreads(env);
    const matched = threads
      .filter((thread) => /^(urn:uuid:)?[0-9a-fA-F-]{36}$/.test(normalizeText(thread?.id)))
      .filter((thread) => {
        const category = normalizeText(thread?.category).toLowerCase();
        const label = normalizeText(thread?.label).toLowerCase();
        const displayLabel = normalizeText(thread?.displayLabel).toLowerCase();

        return (
          (projectId && (category === projectId || label === projectId || displayLabel.startsWith(`${projectId} /`)))
          || (projectLabel && (category === projectLabel || label === projectLabel || displayLabel.startsWith(`${projectLabel} /`)))
        );
      })
      .sort((left, right) => Number(right?.updatedAt || right?.createdAt || 0) - Number(left?.updatedAt || left?.createdAt || 0))[0];

    return normalizeText(matched?.id);
  } catch {
    return "";
  }
}

export { buildSlackCommandPrompt };

export async function postSlackCommand(env, command, mention) {
  const readToken = normalizeText(env?.SLACK_BOT_TOKEN);
  const dispatchToken = resolveSlackDispatchToken(env);
  const channel = normalizeText(env?.SLACK_CODEX_CHANNEL_ID);
  const targetUserId = normalizeText(env?.SLACK_CODEX_USER_ID);

  if (!readToken || !dispatchToken || !channel) {
    throw withCommandError(
      new Error("Slack Codex dispatch is not configured."),
      {
        code: "slack_dispatch_failed",
        stage: "slack-dispatch-failed",
        message: "Slack Codex dispatch is not configured.",
        detail: "Missing SLACK_BOT_TOKEN, SLACK_CODEX_DISPATCH_TOKEN, or SLACK_CODEX_CHANNEL_ID.",
        fallback: "local-bridge"
      }
    );
  }

  const actorValidation = await validateSlackCodexActor(env);

  if (actorValidation.validationStatus !== "validated") {
    throw withCommandError(
      new Error(actorValidation.detail || actorValidation.message || "Configured Slack target actor is not validated."),
      {
        code: actorValidation.code || "codex_target_actor_unverified",
        stage: "codex-target-actor-invalid",
        message: actorValidation.message || "Configured Slack target actor is not validated.",
        detail: actorValidation.detail || "Slack membership is not enough. A live actor probe is required before dispatch.",
        fallback: "local-bridge",
        actorValidation
      }
    );
  }

  const resolvedCodexThreadId = await resolveStoredCodexThreadId(env, command);

  // Post initial task message (without photo URL — not known yet)
  const text = buildSlackCommandPrompt(command, {
    ...env,
    SLACK_CODEX_MENTION: mention
  }, resolvedCodexThreadId);

  const response = await fetchWithTimeout("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: buildSlackHeaders(dispatchToken),
    body: JSON.stringify({
      channel,
      text,
      unfurl_links: false,
      unfurl_media: false,
      mrkdwn: true
    })
  }, getSlackApiTimeoutMs(env), "Slack API chat.postMessage");
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok) {
    throw withCommandError(
      new Error(data?.error || `Slack dispatch failed with ${response.status}.`),
      {
        code: "slack_dispatch_failed",
        stage: "slack-dispatch-failed",
        message: "Slack dispatch failed.",
        detail: data?.error || `Slack dispatch failed with ${response.status}.`,
        fallback: "local-bridge"
      }
    );
  }

  const resolvedChannel = normalizeText(data.channel) || channel;
  const resolvedMessageTs = normalizeText(data.ts);
  const resolvedThreadTs = normalizeText(data.message?.thread_ts) || resolvedMessageTs;
  let uploaded = null;

  if (command?.photo) {
    try {
      uploaded = await uploadSlackPhotoToThread(dispatchToken, resolvedChannel, resolvedThreadTs, command.photo, { env });
      const photoFileUrl = normalizeText(uploaded?.urlPrivateDownload);

      // If we got a direct download URL, update the original task message so
      // Codex sees the curl command in the thread context it reads first.
      if (photoFileUrl) {
        const enrichedText = buildSlackCommandPrompt(
          { ...command, photoFileUrl },
          { ...env, SLACK_CODEX_MENTION: mention },
          resolvedCodexThreadId
        );
        try {
          await callSlackApi(dispatchToken, "chat.update", {
            channel: resolvedChannel,
            ts: resolvedMessageTs,
            text: enrichedText,
            unfurl_links: false,
            unfurl_media: false,
            mrkdwn: true
          }, null, { env });
        } catch (updateError) {
          console.error("[codex-links][slack] chat.update with photo URL failed — non-fatal", {
            error: updateError instanceof Error ? updateError.message : String(updateError || "")
          });
        }
      }

      await postSlackThreadNudge(
        dispatchToken,
        resolvedChannel,
        resolvedThreadTs,
        [
          mention ? `${mention} image uploaded in this thread.` : "Image uploaded in this thread.",
          uploaded?.permalink ? `File: <${uploaded.permalink}|${uploaded.fileName || "uploaded image"}>.` : "",
          photoFileUrl ? `Direct download: ${photoFileUrl}` : "",
          "Acknowledge in this same thread before starting the work."
        ].filter(Boolean).join(" "),
        { env }
      );
    } catch (error) {
      console.error("[codex-links][slack] photo upload failed after thread dispatch", {
        channel: resolvedChannel,
        threadTs: resolvedThreadTs,
        commandId: normalizeText(command?.id),
        error: error instanceof Error ? error.message : String(error || "Slack photo upload failed.")
      });

      return {
        channel: resolvedChannel,
        ts: resolvedMessageTs,
        threadTs: resolvedThreadTs,
        photoUpload: null,
        photoUploadError: error instanceof Error ? error.message : "Slack photo upload failed."
      };
    }
  }

  return {
    channel: resolvedChannel,
    ts: resolvedMessageTs,
    threadTs: resolvedThreadTs,
    photoUpload: uploaded,
    actorValidation
  };
}

export async function verifySlackRequestSignature(request, rawBody, env) {
  const secret = normalizeText(env?.SLACK_SIGNING_SECRET);
  const timestamp = normalizeText(request.headers.get("x-slack-request-timestamp"));
  const signature = normalizeText(request.headers.get("x-slack-signature"));

  if (!secret || !timestamp || !signature) {
    return false;
  }

  const unixTimestamp = Number(timestamp);

  if (!Number.isFinite(unixTimestamp)) {
    return false;
  }

  if (Math.abs(Math.floor(Date.now() / 1000) - unixTimestamp) > 60 * 5) {
    return false;
  }

  const base = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${await signSlackPayload(secret, base)}`;
  return constantTimeEqual(expected, signature);
}

export function isSlackMessageEvent(payload) {
  return payload?.type === "event_callback" && payload?.event?.type === "message";
}

export function extractSlackMessageText(event) {
  if (!event || typeof event !== "object") {
    return "";
  }

  if (typeof event.text === "string" && event.text.trim()) {
    return event.text.trim();
  }

  const blockTexts = (Array.isArray(event.blocks) ? event.blocks : [])
    .flatMap((block) => {
      if (block?.type === "section" && block?.text?.text) {
        return [String(block.text.text)];
      }

      if (Array.isArray(block?.elements)) {
        return block.elements
          .map((element) => String(element?.text || "").trim())
          .filter(Boolean);
      }

      return [];
    })
    .filter(Boolean);

  return blockTexts.join("\n").trim();
}

export function extractGithubPrUrl(text) {
  const match = String(text || "").match(/https:\/\/github\.com\/[^\s)]+\/pull\/\d+/i);
  return match ? match[0].replace(/[>,.]+$/, "") : "";
}

function extractStructuredField(text, name) {
  const pattern = new RegExp(`^\\s*${name}\\s*:\\s*(.+?)\\s*$`, "im");
  const match = String(text || "").match(pattern);
  return match ? normalizeText(match[1], 400) : "";
}

export function extractBranchName(text) {
  const structured = extractStructuredField(text, "BRANCH");

  if (structured && structured.toLowerCase() !== "none") {
    return structured;
  }

  const explicit = String(text || "").match(/branch(?:\s+name)?[:\s]+([A-Za-z0-9._/-]+)/i);

  if (explicit) {
    return explicit[1];
  }

  const codexBranch = String(text || "").match(/\bcodex\/[A-Za-z0-9._/-]+\b/);
  return codexBranch ? codexBranch[0] : "";
}

export function extractMergeCommit(text) {
  const structured = extractStructuredField(text, "MERGE_COMMIT");
  const value = structured || String(text || "").match(/\bmerge commit[:\s]+([a-f0-9]{7,40})\b/i)?.[1] || "";
  return /^[a-f0-9]{7,40}$/i.test(value) ? value : "";
}

export function extractProductionUrl(text) {
  const structured = extractStructuredField(text, "LIVE_URL");
  const value = structured || "";
  return /^https?:\/\//i.test(value) ? value.replace(/[>,.]+$/, "") : "";
}

export function extractVerifyStatus(text) {
  const structured = extractStructuredField(text, "VERIFY_STATUS").toLowerCase();

  if (structured.includes("pass") || structured.includes("verified") || structured.includes("ok")) {
    return "production-verified";
  }

  if (structured.includes("fail") || structured.includes("blocked") || structured.includes("error")) {
    return "blocked";
  }

  return "";
}

function isLikelyProgressOnlySlackReply(text) {
  const value = String(text || "").trim();

  if (!value) {
    return false;
  }

  return /\b(checking|investigating|looking into|working on|reading|starting|preparing|waiting|running|processing|analyzing|analysing|searching|syncing|opening|reviewing|triaging|debugging|retrying|dispatching|queue(?:d)?|queued|in progress|wip|thinking)\b/i.test(value)
    || /(проверяю|смотрю|изучаю|читаю|готовлю|запускаю|жду|обрабатываю|анализирую|ищу|синхронизирую|открываю|разбираю|дебажу|повторяю|в очереди|в работе|работаю)/i.test(value);
}

function isLikelyTerminalPhotoReply(text) {
  const value = String(text || "").trim();
  const lower = value.toLowerCase();

  if (!value) {
    return false;
  }

  return /^observed\s*:/i.test(value)
    || /\bPHOTO_OK\b/i.test(value)
    || /\bimage unreadable\b/i.test(value)
    || /\b(?:on|in) (?:the )?(?:image|photo|screenshot)\b/i.test(value)
    || /\bна (?:изображении|фото|скриншоте|скрине)\b/i.test(lower)
    || /\bвидно\b/i.test(lower);
}

export function isIgnorableSlackReplyText(text) {
  const value = String(text || "").trim();

  if (!value) {
    return true;
  }

  return (
    /\bconnect to your chatgpt codex account\b/i.test(value)
    || /\bafter connecting, tag codex again to continue\b/i.test(value)
    || /\bimage uploaded in this thread\b/i.test(value)
    || /\battached image from codex links request\b/i.test(value)
    || /\backnowledge in this same thread before starting the work\b/i.test(value)
    || /\bfile:\s*<https:\/\/[^>]+>\b/i.test(value)
    || /\bnew codex links task\.\b/i.test(value)
    || /\bconversation label:\b/i.test(value)
    || /\brepository url:\s*<https:\/\/github\.com\/[^>]+>\b/i.test(value)
    || /\bmode:\s*work in codex cloud only inside the selected repository boundary\b/i.test(value)
    || /\breply in this slack thread with progress updates\./i.test(value)
  );
}

export function classifySlackReply(text) {
  const value = String(text || "").trim();
  const lower = value.toLowerCase();
  const prUrl = extractGithubPrUrl(value);
  const branchName = extractBranchName(value);
  const mergeCommit = extractMergeCommit(value);
  const productionUrl = extractProductionUrl(value);
  const verifyStatus = extractVerifyStatus(value);
  const deliveryStatus = verifyStatus
    || (mergeCommit ? "merged" : (prUrl ? "pr-ready" : ""));

  if (
    /\bconnect to your chatgpt codex account\b/i.test(value)
    || /\bafter connecting, tag codex again to continue\b/i.test(value)
  ) {
    return {
      status: "failed",
      progressStage: "codex-account-not-connected",
      prUrl,
      branchName,
      mergeCommit,
      productionUrl,
      deliveryStatus: "blocked"
    };
  }

  if (
    /\bconnect to your chatgpt codex account\b/i.test(value)
    || /\bafter connecting, tag codex again to continue\b/i.test(value)
  ) {
    return {
      status: "failed",
      progressStage: "codex-account-not-connected",
      prUrl,
      branchName: ""
    };
  }

  if (isIgnorableSlackReplyText(value)) {
    return {
      status: "processing",
      progressStage: "ignored-helper",
      prUrl,
      branchName,
      mergeCommit,
      productionUrl,
      deliveryStatus
    };
  }

  if (
    /\b(error|failed|failure|unable|blocked|need access|permission denied|could not|can'?t complete)\b/i.test(value)
  ) {
    return {
      status: "failed",
      progressStage: "failed",
      prUrl,
      branchName,
      mergeCommit,
      productionUrl,
      deliveryStatus: deliveryStatus || "blocked"
    };
  }

  if (
    prUrl
    || /\b(pr ready|pull request|opened pr|created pr|implemented|completed|finished|done|готово|исправил|сделал)\b/i.test(lower)
    || isLikelyTerminalPhotoReply(value)
  ) {
    return {
      status: "answered",
      progressStage: "answered",
      prUrl,
      branchName,
      mergeCommit,
      productionUrl,
      deliveryStatus
    };
  }

  if (isLikelyProgressOnlySlackReply(value)) {
    return {
      status: "processing",
      progressStage: "processing",
      prUrl,
      branchName,
      mergeCommit,
      productionUrl,
      deliveryStatus: deliveryStatus || "cloud-running"
    };
  }

  return {
    status: "answered",
    progressStage: "answered",
    prUrl,
    branchName,
    mergeCommit,
    productionUrl,
    deliveryStatus
  };
}

export function isLikelyCodexSlackActor(runtimeConfig, event, options = {}) {
  const targetUserId = normalizeText(runtimeConfig?.SLACK_CODEX_USER_ID);
  const userId = normalizeText(event?.user);
  const subtype = normalizeText(event?.subtype);
  const botId = normalizeText(event?.bot_id || event?.botId);
  const candidateCount = Number(options.candidateCount || 0);

  if (targetUserId && userId === targetUserId) {
    return true;
  }

  if (targetUserId) {
    return false;
  }

  if (botId || subtype === "bot_message") {
    return candidateCount <= 1;
  }

  return false;
}
