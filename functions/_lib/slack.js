import { constantTimeEqual } from "./security.js";
import { createCommandError } from "./command-debug.js";

const encoder = new TextEncoder();

function normalizeText(value) {
  return String(value || "").trim();
}

function isSlackCloudDiagnosticsEnabled(env) {
  const value = normalizeText(env?.SLACK_CLOUD_DIAGNOSTICS).toLowerCase();
  return value === "1" || value === "true";
}

function withStageTimestamp(enabled, stage, timestamp) {
  if (!enabled || !stage) {
    return {};
  }

  return {
    [`${stage}At`]: normalizeText(timestamp || new Date().toISOString())
  };
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

function buildSlackAuthHeaders(token, headers = {}) {
  return {
    authorization: `Bearer ${token}`,
    ...headers
  };
}

function encodeSlackFormBody(body) {
  const params = new URLSearchParams();

  Object.entries(body || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }

    if (Array.isArray(value) || (value && typeof value === "object")) {
      params.set(key, JSON.stringify(value));
      return;
    }

    params.set(key, String(value));
  });

  return params;
}

function formatSlackError(data, fallbackMessage) {
  const error = normalizeText(data?.error);
  const metadataMessages = Array.isArray(data?.response_metadata?.messages)
    ? data.response_metadata.messages.map((entry) => normalizeText(entry)).filter(Boolean)
    : [];
  const detail = metadataMessages.join(" ");

  if (error && detail) {
    return `${error}: ${detail}`;
  }

  return error || detail || fallbackMessage;
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

async function callSlackApi(token, method, body = null, query = null, options = {}) {
  const url = new URL(`https://slack.com/api/${method}`);

  if (query && typeof query === "object") {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim()) {
        url.searchParams.set(key, String(value));
      }
    });
  }

  const bodyEncoding = normalizeText(options.bodyEncoding).toLowerCase() || "json";
  const headers = bodyEncoding === "form"
    ? buildSlackAuthHeaders(token, {
        "content-type": "application/x-www-form-urlencoded"
      })
    : buildSlackHeaders(token);
  const requestBody = body
    ? (bodyEncoding === "form" ? encodeSlackFormBody(body) : JSON.stringify(body))
    : undefined;

  const response = await fetch(url.toString(), {
    method: body ? "POST" : "GET",
    headers,
    body: requestBody
  });
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok) {
    throw new Error(formatSlackError(data, `Slack API ${method} failed with ${response.status}.`));
  }

  return data;
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

async function uploadSlackPhotoToThread(token, channel, threadTs, photo) {
  if (!photo || typeof photo !== "object") {
    return null;
  }

  const fileName = normalizeText(photo.fileName) || "photo";
  const decoded = decodeSlackDataUrl(photo.dataUrl);
  const contentType = normalizeText(photo.contentType) || decoded.contentType;
  const length = Number(photo.size || decoded.bytes.byteLength || 0) || decoded.bytes.byteLength;
  const upload = await callSlackApi(token, "files.getUploadURLExternal", {
    filename: fileName,
    length
  }, null, {
    bodyEncoding: "form"
  });

  const uploadResponse = await fetch(String(upload.upload_url || ""), {
    method: "POST",
    headers: {
      "content-type": contentType,
      "content-length": String(length)
    },
    body: decoded.bytes
  });

  if (!uploadResponse.ok) {
    throw new Error(`Slack file upload failed with ${uploadResponse.status}.`);
  }

  const completed = await callSlackApi(token, "files.completeUploadExternal", {
    files: [
      {
        id: normalizeText(upload.file_id),
        title: fileName
      }
    ],
    channel_id: channel,
    thread_ts: threadTs,
    initial_comment: "Attached image from Codex Links request."
  });

  const completedFile = Array.isArray(completed?.files)
    ? completed.files.find((file) => normalizeText(file?.id) === normalizeText(upload.file_id)) || completed.files[0]
    : null;
  const permalink = normalizeText(completedFile?.permalink || completedFile?.permalink_public);
  const fileMode = normalizeText(completedFile?.mode);
  const fileAccess = normalizeText(completedFile?.file_access);
  const urlPrivate = normalizeText(completedFile?.url_private_download || completedFile?.url_private);

  const probe = urlPrivate
    ? await probeSlackFileOpen(token, urlPrivate).catch(() => ({ canOpen: false, status: 0 }))
    : { canOpen: false, status: 0 };

  return {
    fileId: normalizeText(upload.file_id),
    permalink,
    fileName,
    fileMode,
    fileAccess,
    urlPrivate,
    botCanOpenFile: Boolean(probe.canOpen),
    botOpenHttpStatus: Number(probe.status || 0)
  };
}

async function postSlackThreadNudge(token, channel, threadTs, text) {
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
  });
}

export async function fetchSlackThreadReplies(env, channel, threadTs) {
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
  });

  return (Array.isArray(data?.messages) ? data.messages : [])
    .filter((message) => String(message?.ts || "").trim() && String(message?.thread_ts || message?.ts || "").trim() === normalizedThreadTs)
    .map((message) => ({
      ts: normalizeText(message?.ts),
      threadTs: normalizeText(message?.thread_ts || message?.ts),
      text: extractSlackMessageText(message),
      user: normalizeText(message?.user),
      botId: normalizeText(message?.bot_id),
      subtype: normalizeText(message?.subtype)
    }));
}

function extractFileFromMessage(message) {
  const files = Array.isArray(message?.files) ? message.files : [];
  const file = files.find((entry) => normalizeText(entry?.id)) || null;

  if (!file) {
    return null;
  }

  return {
    id: normalizeText(file.id),
    mode: normalizeText(file.mode),
    access: normalizeText(file.file_access),
    urlPrivate: normalizeText(file.url_private_download || file.url_private)
  };
}

async function probeSlackFileOpen(token, url) {
  const target = normalizeText(url);

  if (!token || !target) {
    return { canOpen: false, status: 0 };
  }

  const response = await fetch(target, {
    headers: buildSlackAuthHeaders(token, {
      range: "bytes=0-0"
    }),
    signal: AbortSignal.timeout(10_000)
  });

  try {
    await response.arrayBuffer();
  } catch {}

  return {
    canOpen: response.ok,
    status: response.status
  };
}

export async function inspectSlackPhotoDelivery(env, runtimeConfig, input = {}) {
  const token = normalizeText(env?.SLACK_BOT_TOKEN || runtimeConfig?.SLACK_BOT_TOKEN);
  const diagnosticsEnabled = isSlackCloudDiagnosticsEnabled(runtimeConfig || env);
  const channelId = normalizeText(input.channelId);
  const threadTs = normalizeText(input.threadTs);
  const requestedFileId = normalizeText(input.fileId);
  const inspectedAt = new Date().toISOString();

  if (!token || !channelId || !threadTs) {
    return {
      inspectedAt,
      threadRootSeen: false,
      slackRootPosted: false,
      slackThreadMapped: false,
      slackPhotoUploaded: false,
      slackFileVisible: false,
      slackFileOpenOk: false,
      uploadNoticeSeen: false,
      fileReplySeen: false,
      fileId: requestedFileId,
      fileMode: "",
      fileAccess: "",
      botCanOpenFile: false,
      botOpenHttpStatus: 0,
      workerReplySeen: false,
      workerAckSeen: false,
      workerPhotoReadySeen: false,
      executionAckSeen: false,
      photoReadySeen: false,
      ...(diagnosticsEnabled ? {
        matchedChannelId: channelId,
        matchedThreadTs: threadTs
      } : {})
    };
  }

  const data = await callSlackApi(token, "conversations.replies", null, {
    channel: channelId,
    ts: threadTs,
    inclusive: true,
    limit: 100
  });
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  const replies = messages.filter((message) => normalizeText(message?.ts) && normalizeText(message?.ts) !== threadTs);
  const root = messages.find((message) => normalizeText(message?.ts) === threadTs) || null;
  const uploadNotice = replies.find((message) => isIgnorableSlackReplyText(extractSlackMessageText(message))) || null;
  const fileMessage = replies.find((message) => extractFileFromMessage(message)) || null;
  const fileFromMessage = extractFileFromMessage(fileMessage);
  const fileId = requestedFileId || normalizeText(fileFromMessage?.id);

  let fileFromInfo = null;

  if (fileId) {
    try {
      const info = await callSlackApi(token, "files.info", null, {
        file: fileId
      });
      const file = info?.file || {};
      fileFromInfo = {
        id: normalizeText(file.id),
        mode: normalizeText(file.mode),
        access: normalizeText(file.file_access),
        urlPrivate: normalizeText(file.url_private_download || file.url_private)
      };
    } catch {}
  }

  const workerReplies = replies.filter((message) =>
    isLikelyCodexSlackActor(runtimeConfig, message, { candidateCount: 1 })
      && !isIgnorableSlackReplyText(extractSlackMessageText(message))
  );
  const ack = workerReplies
    .map((message) => parseStructuredExecutionAck(extractSlackMessageText(message)))
    .find((entry) => entry.present) || null;
  const file = fileFromInfo || fileFromMessage;
  const probe = file?.urlPrivate
    ? await probeSlackFileOpen(token, file.urlPrivate).catch(() => ({ canOpen: false, status: 0 }))
    : { canOpen: false, status: 0 };

  return {
    inspectedAt,
    threadRootSeen: Boolean(root),
    slackRootPosted: Boolean(root),
    slackThreadMapped: Boolean(root) && Boolean(channelId) && Boolean(threadTs),
    slackPhotoUploaded: Boolean(fileFromMessage || fileId),
    slackFileVisible: normalizeText(file?.access).toLowerCase() === "visible",
    slackFileOpenOk: Boolean(probe.canOpen),
    uploadNoticeSeen: Boolean(uploadNotice),
    fileReplySeen: Boolean(fileFromMessage),
    fileId: normalizeText(file?.id || fileId),
    fileMode: normalizeText(file?.mode),
    fileAccess: normalizeText(file?.access),
    botCanOpenFile: Boolean(probe.canOpen),
    botOpenHttpStatus: Number(probe.status || 0),
    workerReplySeen: workerReplies.length > 0,
    workerAckSeen: Boolean(ack?.present),
    workerPhotoReadySeen: ack?.photoReady === true,
    executionAckSeen: Boolean(ack?.present),
    photoReadySeen: ack?.photoReady === true,
    ...(diagnosticsEnabled ? {
      matchedChannelId: channelId,
      matchedThreadTs: threadTs,
      ...withStageTimestamp(true, "slackRootPosted", root?.ts ? new Date(Number(root.ts) * 1000 || Date.now()).toISOString() : ""),
      ...withStageTimestamp(true, "slackPhotoUploaded", fileFromMessage?.ts ? new Date(Number(fileFromMessage.ts) * 1000 || Date.now()).toISOString() : ""),
      ...withStageTimestamp(true, "slackFileVisible", normalizeText(file?.access).toLowerCase() === "visible" ? inspectedAt : ""),
      ...withStageTimestamp(true, "slackFileOpenOk", probe.canOpen ? inspectedAt : ""),
      ...withStageTimestamp(true, "workerReplySeen", workerReplies[0]?.ts ? new Date(Number(workerReplies[0].ts) * 1000 || Date.now()).toISOString() : ""),
      ...withStageTimestamp(true, "workerAckSeen", ack?.present ? inspectedAt : ""),
      ...withStageTimestamp(true, "workerPhotoReadySeen", ack?.photoReady === true ? inspectedAt : "")
    } : {})
  };
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
  });

  return (Array.isArray(data?.messages) ? data.messages : []).map((message) => ({
    ts: normalizeText(message?.ts),
    threadTs: normalizeText(message?.thread_ts || message?.ts),
    text: extractSlackMessageText(message),
    user: normalizeText(message?.user),
    botId: normalizeText(message?.bot_id),
    subtype: normalizeText(message?.subtype)
  }));
}

async function validateSlackTarget(token, channel, targetUserId) {
  const normalizedTarget = normalizeText(targetUserId);

  if (!normalizedTarget) {
    return;
  }

  const auth = await callSlackApi(token, "auth.test");
  const botUserId = normalizeText(auth.user_id);

  if (botUserId && normalizedTarget === botUserId) {
    throw withCommandError(
      new Error("SLACK_CODEX_USER_ID points to the Codex Links bot itself, not a Codex worker."),
      {
        code: "codex_target_user_invalid",
        stage: "codex-target-user-invalid",
        message: "Configured Slack target user points to the Codex Links bot.",
        detail: "Set SLACK_CODEX_USER_ID to the Codex worker user, not the app bot user.",
        fallback: "local-bridge"
      }
    );
  }

  const members = await callSlackApi(token, "conversations.members", null, { channel });
  const memberIds = Array.isArray(members.members) ? members.members.map((value) => normalizeText(value)) : [];

  if (!memberIds.includes(normalizedTarget)) {
    throw withCommandError(
      new Error("Configured Slack Codex user is not a member of the dispatch channel."),
      {
        code: "codex_target_user_invalid",
        stage: "codex-target-user-invalid",
        message: "Configured Slack target user is not in the dispatch channel.",
        detail: "Invite the target Codex user to SLACK_CODEX_CHANNEL_ID or update SLACK_CODEX_USER_ID.",
        fallback: "local-bridge"
      }
    );
  }
}

export function buildSlackCommandPrompt(command, env) {
  const threadId = normalizeText(command?.threadId);
  const threadLabel = normalizeText(command?.threadLabel) || threadId || "Links";
  const projectCategory = normalizeText(command?.projectCategory) || "other";
  const projectLabel = normalizeText(command?.projectLabel) || threadLabel;
  const projectId = normalizeText(command?.projectId) || threadId;
  const targetRepo = normalizeText(command?.targetRepo);
  const targetRepoUrl = normalizeText(command?.targetRepoUrl);
  const targetWorkspacePath = normalizeText(command?.targetWorkspacePath);
  const codexThreadId = /^(urn:uuid:)?[0-9a-fA-F-]{36}$/.test(threadId) ? threadId : "";
  const contextFiles = Array.isArray(command?.targetContextFiles) && command.targetContextFiles.length
    ? command.targetContextFiles.map((item) => normalizeText(item)).filter(Boolean)
    : ["AGENTS.md", "README.md", "STATE.md"];
  const photoNote = command?.photo
    ? "\n\nAn image from Codex Links is attached in a file reply inside this same Slack thread. Read the attached image before doing the work. If the image is missing, say so in-thread and wait."
    : "";
  const repoUrlLine = targetRepoUrl ? `Repository URL: ${targetRepoUrl}` : "";
  const workspacePathLine = targetWorkspacePath ? `Workspace path: ${targetWorkspacePath}` : "";
  const contextLine = contextFiles.length
    ? `Start by reading repo root context files in order: ${contextFiles.join(" -> ")}.`
    : "Start by reading the repo root context files first.";

  return [
    `${String(env?.SLACK_CODEX_MENTION || "").trim() || ""}`.trim(),
    "New Codex Links task.",
    "",
    `Project: ${projectCategory} / ${projectLabel}`,
    `Project Key: ${projectId}`,
    `Repository: ${targetRepo}`,
    repoUrlLine,
    workspacePathLine,
    `Conversation Label: ${threadLabel}`,
    codexThreadId ? `Codex Thread ID: ${codexThreadId}` : "",
    `Command ID: ${normalizeText(command?.id)}`,
    "Mode: work in Codex Cloud only inside the selected repository boundary.",
    "Do not switch to sibling repositories or unrelated workspace folders.",
    "Important: Conversation Label is a human label, not a thread id.",
    "If Codex Thread ID is absent, create or reuse the correct Codex thread inside the target repository yourself.",
    contextLine,
    "Immediately reply in this Slack thread with a short acknowledgement before doing the work.",
    "Keep every progress update and the final result in the same Slack thread.",
    "Delivery rule: create a branch and PR, never push directly to main.",
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
    throw withCommandError(
      new Error("Slack Codex dispatch is not configured."),
      {
        code: "slack_dispatch_failed",
        stage: "slack-dispatch-failed",
        message: "Slack Codex dispatch is not configured.",
        detail: "Missing SLACK_BOT_TOKEN or SLACK_CODEX_CHANNEL_ID.",
        fallback: "local-bridge"
      }
    );
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
  const resolvedThreadTs = normalizeText(data.message?.thread_ts) || normalizeText(data.ts);

  let photoUpload = null;

  if (command?.photo) {
    try {
      const uploaded = await uploadSlackPhotoToThread(token, resolvedChannel, resolvedThreadTs, command.photo);
      photoUpload = uploaded;
      await postSlackThreadNudge(
        token,
        resolvedChannel,
        resolvedThreadTs,
        [
          mention ? `${mention} image uploaded in this thread.` : "Image uploaded in this thread.",
          uploaded?.permalink ? `File: <${uploaded.permalink}|${uploaded.fileName || "uploaded image"}>.` : "",
          "Acknowledge in this same thread before starting the work."
        ].filter(Boolean).join(" ")
      );
    } catch (error) {
      throw withCommandError(
        new Error(error instanceof Error ? error.message : "Slack photo upload failed."),
        {
          code: "slack_photo_upload_failed",
          stage: "slack-photo-upload-failed",
          message: "Slack photo upload failed.",
          detail: error instanceof Error ? error.message : "Slack photo upload failed.",
          fallback: "local-bridge"
        }
      );
    }
  }

  return {
    channel: resolvedChannel,
    ts: normalizeText(data.ts),
    threadTs: resolvedThreadTs,
    photoUpload
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

function isLikelyProgressOnlySlackReply(text) {
  const value = String(text || "").trim();

  if (!value) {
    return false;
  }

  return /\b(checking|investigating|looking into|working on|reading|starting|preparing|waiting|running|processing|analyzing|analysing|searching|syncing|opening|reviewing|triaging|debugging|retrying|dispatching|queue(?:d)?|queued|in progress|wip|thinking)\b/i.test(value)
    || /(проверяю|смотрю|изучаю|читаю|готовлю|запускаю|жду|обрабатываю|анализирую|ищу|синхронизирую|открываю|разбираю|дебажу|повторяю|в очереди|в работе|работаю)/i.test(value);
}

export function isIgnorableSlackReplyText(text) {
  const value = String(text || "").trim();

  if (!value) {
    return true;
  }

  return (
    /\bimage uploaded in this thread\b/i.test(value)
    || /\battached image from codex links request\b/i.test(value)
    || /\backnowledge in this same thread before starting the work\b/i.test(value)
    || /\bfile:\s*<https:\/\/[^>]+>\b/i.test(value)
  );
}

export function classifySlackReply(text) {
  const value = String(text || "").trim();
  const lower = value.toLowerCase();
  const prUrl = extractGithubPrUrl(value);

  if (isIgnorableSlackReplyText(value)) {
    return {
      status: "processing",
      progressStage: "ignored-helper",
      prUrl,
      branchName: ""
    };
  }

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

  if (isLikelyProgressOnlySlackReply(value)) {
    return {
      status: "processing",
      progressStage: "processing",
      prUrl,
      branchName: extractBranchName(value)
    };
  }

  return {
    status: "answered",
    progressStage: "answered",
    prUrl,
    branchName: extractBranchName(value)
  };
}

function normalizeAckBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value || "").trim().toLowerCase();

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  return null;
}

export function parseStructuredExecutionAck(text) {
  const value = String(text || "").trim();
  const match = value.match(/\bCODEX_LINKS_EXECUTION_ACK\b\s*[:=-]?\s*({[\s\S]*})/i);

  if (!match) {
    return {
      present: false,
      valid: false,
      photoReady: null,
      payload: null,
      detail: ""
    };
  }

  try {
    const payload = JSON.parse(match[1]);
    const kind = String(payload?.type || payload?.kind || payload?.event || "CODEX_LINKS_EXECUTION_ACK").trim().toUpperCase();
    const status = String(payload?.status || payload?.state || "").trim().toLowerCase();
    const photoReady = normalizeAckBoolean(payload?.photo_ready);
    const validKind = kind === "CODEX_LINKS_EXECUTION_ACK";
    const validStatus = !status || ["accepted", "started", "processing", "running"].includes(status);

    return {
      present: true,
      valid: validKind && validStatus,
      photoReady,
      payload,
      detail: validKind && validStatus
        ? ""
        : "Structured execution ack must use type CODEX_LINKS_EXECUTION_ACK and a startup status."
    };
  } catch (error) {
    return {
      present: true,
      valid: false,
      photoReady: null,
      payload: null,
      detail: error instanceof Error ? error.message : "Invalid execution ack JSON."
    };
  }
}

export function deriveSlackReplyOutcome(command, text) {
  const classification = classifySlackReply(text);
  const ack = parseStructuredExecutionAck(text);
  const requiresPhotoReady = Boolean(command?.photoAttached || command?.photo || command?.photoBytesPresent);
  const hasPriorExecutionAck = Boolean(String(command?.firstExecutorAckSeenAt || "").trim());
  const executionAckValid = ack.present && ack.valid && (!requiresPhotoReady || ack.photoReady === true);
  const baseStatus = String(command?.status || "").trim().toLowerCase() || "dispatched";

  if (ack.present) {
    if (executionAckValid) {
      return {
        ...classification,
        status: "processing",
        progressStage: requiresPhotoReady ? "execution-ack-photo-ready" : "execution-ack",
        executionAckPresent: true,
        executionAckValid: true,
        executionAckPhotoReady: ack.photoReady === true,
        lastDiagnosticCode: "",
        lastDiagnosticDetail: ""
      };
    }

    return {
      ...classification,
      status: hasPriorExecutionAck || baseStatus === "processing" ? "processing" : "dispatched",
      progressStage: requiresPhotoReady ? "waiting-photo-ready" : "waiting-execution-ack",
      executionAckPresent: true,
      executionAckValid: false,
      executionAckPhotoReady: ack.photoReady === true,
      lastDiagnosticCode: requiresPhotoReady ? "cloud_photo_not_ready" : "execution_ack_invalid",
      lastDiagnosticDetail: requiresPhotoReady
        ? "Structured execution ack was received without photo_ready=true."
        : (ack.detail || "Structured execution ack was invalid.")
    };
  }

  if (classification.status === "answered" || classification.status === "failed") {
    return {
      ...classification,
      executionAckPresent: false,
      executionAckValid: false,
      executionAckPhotoReady: false,
      lastDiagnosticCode: "",
      lastDiagnosticDetail: ""
    };
  }

  if (!hasPriorExecutionAck) {
    return {
      ...classification,
      status: baseStatus === "processing" ? "processing" : "dispatched",
      progressStage: "waiting-execution-ack",
      executionAckPresent: false,
      executionAckValid: false,
      executionAckPhotoReady: false,
      lastDiagnosticCode: "",
      lastDiagnosticDetail: ""
    };
  }

  return {
    ...classification,
    executionAckPresent: false,
    executionAckValid: false,
    executionAckPhotoReady: false,
    lastDiagnosticCode: "",
    lastDiagnosticDetail: ""
  };
}

export function isLikelyCodexSlackActor(runtimeConfig, event, options = {}) {
  const targetUserId = normalizeText(runtimeConfig?.SLACK_CODEX_USER_ID);
  const userId = normalizeText(event?.user);
  const subtype = normalizeText(event?.subtype);
  const botId = normalizeText(event?.bot_id);
  const candidateCount = Number(options.candidateCount || 0);

  if (targetUserId && userId === targetUserId) {
    return true;
  }

  if (botId || subtype === "bot_message") {
    return candidateCount <= 1;
  }

  return false;
}
