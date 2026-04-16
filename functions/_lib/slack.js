import { constantTimeEqual } from "./security.js";

const encoder = new TextEncoder();

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

async function callSlackApi(token, method, body = null, query = null) {
  const url = new URL(`https://slack.com/api/${method}`);

  if (query && typeof query === "object") {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim()) {
        url.searchParams.set(key, String(value));
      }
    });
  }

  const response = await fetch(url.toString(), {
    method: body ? "POST" : "GET",
    headers: buildSlackHeaders(token),
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || `Slack API ${method} failed with ${response.status}.`);
  }

  return data;
}

async function validateSlackTarget(token, channel, targetUserId) {
  const normalizedTarget = normalizeText(targetUserId);

  if (!normalizedTarget) {
    return;
  }

  const auth = await callSlackApi(token, "auth.test");
  const botUserId = normalizeText(auth.user_id);

  if (botUserId && normalizedTarget === botUserId) {
    throw new Error("SLACK_CODEX_USER_ID points to the Codex Links bot itself, not a Codex worker.");
  }

  const members = await callSlackApi(token, "conversations.members", null, { channel });
  const memberIds = Array.isArray(members.members) ? members.members.map((value) => normalizeText(value)) : [];

  if (!memberIds.includes(normalizedTarget)) {
    throw new Error("Configured Slack Codex user is not a member of the dispatch channel.");
  }
}

export function buildSlackCommandPrompt(command, env) {
  const threadLabel = normalizeText(command?.threadLabel) || normalizeText(command?.threadId) || "Links";
  const photoNote = command?.photo
    ? "\n\nФото было приложено в Codex Links, но облачный Slack-trigger v1 пока не пересылает изображение. Если без фото задачу выполнить нельзя, ответь об этом явно."
    : "";

  return [
    `${String(env?.SLACK_CODEX_MENTION || "").trim() || ""}`.trim(),
    "New Codex Links task.",
    "",
    `Repository: andylitvinov-design/codex-links`,
    `Conversation: ${threadLabel}`,
    `Command ID: ${normalizeText(command?.id)}`,
    "Mode: work in Codex Cloud, create a branch and PR, never push directly to main.",
    "",
    "User request:",
    normalizeText(command?.text) || "User sent a photo-only request.",
    photoNote,
    "",
    "Reply in this Slack thread with progress updates. Include the PR URL when ready."
  ]
    .filter(Boolean)
    .join("\n");
}

export async function postSlackCommand(env, command, mention) {
  const token = normalizeText(env?.SLACK_BOT_TOKEN);
  const channel = normalizeText(env?.SLACK_CODEX_CHANNEL_ID);
  const targetUserId = normalizeText(env?.SLACK_CODEX_USER_ID);

  if (!token || !channel) {
    throw new Error("Slack Codex dispatch is not configured.");
  }

  await validateSlackTarget(token, channel, targetUserId);

  const text = buildSlackCommandPrompt(command, {
    ...env,
    SLACK_CODEX_MENTION: mention
  });
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: buildSlackHeaders(token),
    body: JSON.stringify({
      channel,
      text,
      unfurl_links: false,
      unfurl_media: false,
      mrkdwn: true
    })
  });
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || `Slack dispatch failed with ${response.status}.`);
  }

  return {
    channel: normalizeText(data.channel) || channel,
    ts: normalizeText(data.ts),
    threadTs: normalizeText(data.message?.thread_ts) || normalizeText(data.ts)
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
  return match ? match[0] : "";
}

export function extractBranchName(text) {
  const explicit = String(text || "").match(/branch(?:\s+name)?[:\s]+([A-Za-z0-9._/-]+)/i);

  if (explicit) {
    return explicit[1];
  }

  const codexBranch = String(text || "").match(/\bcodex\/[A-Za-z0-9._/-]+\b/);
  return codexBranch ? codexBranch[0] : "";
}

export function classifySlackReply(text) {
  const value = String(text || "").trim();
  const lower = value.toLowerCase();
  const prUrl = extractGithubPrUrl(value);

  if (
    /\b(error|failed|failure|unable|blocked|need access|permission denied|could not|can'?t complete)\b/i.test(value)
  ) {
    return {
      status: "failed",
      progressStage: "failed",
      prUrl,
      branchName: extractBranchName(value)
    };
  }

  if (
    prUrl
    || /\b(pr ready|pull request|opened pr|created pr|implemented|completed|finished|done|готово|исправил|сделал)\b/i.test(lower)
  ) {
    return {
      status: "answered",
      progressStage: "answered",
      prUrl,
      branchName: extractBranchName(value)
    };
  }

  return {
    status: "processing",
    progressStage: "processing",
    prUrl,
    branchName: extractBranchName(value)
  };
}
