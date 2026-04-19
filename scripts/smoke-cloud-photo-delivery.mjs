#!/usr/bin/env node

import fs from "node:fs";

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return Object.fromEntries(
    fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      })
  );
}

const FILE_ENV = parseEnvFile(".dev.vars");

const BASE_URL = process.env.CODEX_LINKS_URL || FILE_ENV.CODEX_LINKS_URL || "https://codex-links.pages.dev";
const TARGET_PROJECT_ID = process.env.CODEX_LINKS_SMOKE_PROJECT_ID || FILE_ENV.CODEX_LINKS_SMOKE_PROJECT_ID || "links";
const TARGET_PROJECT_LABEL = process.env.CODEX_LINKS_SMOKE_PROJECT_LABEL || FILE_ENV.CODEX_LINKS_SMOKE_PROJECT_LABEL || "links";
const TARGET_REPO = process.env.CODEX_LINKS_SMOKE_REPO || FILE_ENV.CODEX_LINKS_SMOKE_REPO || "andylitvinov-design/codex-links";
const TARGET_REPO_URL = process.env.CODEX_LINKS_SMOKE_REPO_URL || FILE_ENV.CODEX_LINKS_SMOKE_REPO_URL || "https://github.com/andylitvinov-design/codex-links";
const TARGET_CONTEXT_FILES = ["AGENTS.md", "README.md", "STATE.md"];
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || FILE_ENV.SLACK_BOT_TOKEN || "";
const LINKS_WRITE_TOKEN = process.env.LINKS_WRITE_TOKEN || FILE_ENV.LINKS_WRITE_TOKEN || "";
const clientId = `cloud-photo-smoke-${Date.now()}`;
const text = "photo cloud probe ignore: reply with CODEX_LINKS_EXECUTION_ACK including photo_ready=true, then PHOTO_OK only after reading the attached image in thread";
const photoDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sot7O8AAAAASUVORK5CYII=";

function parseExecutionAck(text) {
  const match = String(text || "").match(/\bCODEX_LINKS_EXECUTION_ACK\b\s*[:=-]?\s*({[\s\S]*})/i);

  if (!match) {
    return null;
  }

  try {
    return JSON.parse(match[1]);
  } catch {
    return { invalid: true };
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSlackJson(url) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url.toString(), {
      headers: {
        authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        accept: "application/json"
      }
    });
    const data = await response.json().catch(() => ({}));

    if (response.ok && data?.ok) {
      return data;
    }

    if (String(data?.error || "").trim() === "ratelimited") {
      await sleep(1500 * (attempt + 1));
      continue;
    }

    throw new Error(`Slack request failed: ${String(data?.error || response.status).trim()}`);
  }

  throw new Error("Slack request failed: ratelimited");
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

function assertManifestContext(command, label) {
  if (!command || typeof command !== "object") {
    throw new Error(`${label}: command payload is missing.`);
  }

  const projectId = String(command.projectId || command.threadId || "").trim();
  const targetRepo = String(command.targetRepo || "").trim();
  const targetRepoUrl = String(command.targetRepoUrl || "").trim();
  const targetContextFiles = normalizeStringArray(command.targetContextFiles);

  if (projectId !== TARGET_PROJECT_ID) {
    throw new Error(`${label}: expected projectId=${TARGET_PROJECT_ID}, got ${projectId || "empty"}.`);
  }

  if (targetRepo !== TARGET_REPO) {
    throw new Error(`${label}: expected targetRepo=${TARGET_REPO}, got ${targetRepo || "empty"}.`);
  }

  if (targetRepoUrl !== TARGET_REPO_URL) {
    throw new Error(`${label}: expected targetRepoUrl=${TARGET_REPO_URL}, got ${targetRepoUrl || "empty"}.`);
  }

  if (targetContextFiles.join("::") !== TARGET_CONTEXT_FILES.join("::")) {
    throw new Error(`${label}: expected targetContextFiles=${TARGET_CONTEXT_FILES.join(", ")}, got ${targetContextFiles.join(", ") || "empty"}.`);
  }
}

async function fetchAssistantReplies(commandId) {
  const response = await fetch(`${BASE_URL}/api/messages?scope=public`, {
    headers: { accept: "application/json" }
  });
  const data = await response.json().catch(() => ({}));

  return Array.isArray(data?.messages)
    ? data.messages.filter((message) =>
        String(message?.commandId || "").trim() === String(commandId || "").trim()
        && String(message?.role || "").trim() === "assistant"
      )
    : [];
}

async function fetchSlackThreadReplies(channelId, threadTs) {
  if (!SLACK_BOT_TOKEN || !channelId || !threadTs) {
    return [];
  }

  const url = new URL("https://slack.com/api/conversations.replies");
  url.searchParams.set("channel", channelId);
  url.searchParams.set("ts", threadTs);
  url.searchParams.set("inclusive", "true");
  url.searchParams.set("limit", "100");
  const data = await fetchSlackJson(url);

  return Array.isArray(data?.messages)
    ? data.messages.filter((message) => String(message?.ts || "").trim() !== String(threadTs || "").trim()).map((message) => ({
        ...message,
        files: Array.isArray(message?.files)
          ? message.files.map((file) => ({
              id: String(file?.id || "").trim(),
              mode: String(file?.mode || "").trim(),
              file_access: String(file?.file_access || "").trim(),
              url_private: String(file?.url_private || "").trim(),
              url_private_download: String(file?.url_private_download || "").trim()
            }))
          : []
      }))
    : [];
}

async function fetchSlackFileInfo(fileId) {
  if (!SLACK_BOT_TOKEN || !fileId) {
    return null;
  }

  const url = new URL("https://slack.com/api/files.info");
  url.searchParams.set("file", fileId);

  const data = await fetchSlackJson(url);

  return data.file || null;
}

async function probeSlackFile(file) {
  const target = String(file?.url_private_download || file?.url_private || "").trim();

  if (!SLACK_BOT_TOKEN || !target) {
    return { ok: false, status: 0 };
  }

  const response = await fetch(target, {
    headers: {
      authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      range: "bytes=0-0"
    }
  });

  try {
    await response.arrayBuffer();
  } catch {}

  return {
    ok: response.ok,
    status: response.status
  };
}

function summarizeSlackDelivery(command, replies, file) {
  const uploadNotice = replies.find((reply) => /image uploaded in this thread/i.test(String(reply?.text || "")));
  const fileReply = replies.find((reply) => Array.isArray(reply?.files) && reply.files.length > 0);
  const workerReply = replies.find((reply) =>
    !/image uploaded in this thread/i.test(String(reply?.text || ""))
      && !/attached image from codex links request/i.test(String(reply?.text || ""))
  );
  const ackReply = replies.find((reply) => parseExecutionAck(String(reply?.text || "")));
  const ackPayload = ackReply ? parseExecutionAck(String(ackReply.text || "")) : null;

  return {
    commandId: String(command?.id || "").trim(),
    slackChannelId: String(command?.slackChannelId || "").trim(),
    slackThreadTs: String(command?.slackThreadTs || command?.slackMessageTs || "").trim(),
    fileId: String(file?.id || fileReply?.files?.[0]?.id || "").trim(),
    status: String(command?.status || "").trim(),
    progressStage: String(command?.progressStage || "").trim(),
    lastDiagnosticCode: String(command?.lastDiagnosticCode || "").trim(),
    lastDiagnosticDetail: String(command?.lastDiagnosticDetail || "").trim(),
    deliveryStopPoint: String(command?.deliveryStopPoint || "").trim(),
    deliveryEvidence: command?.deliveryEvidence || null,
    matrix: {
      slackRootPosted: Boolean(command?.deliveryEvidence?.slackRootPosted || command?.slackMessageTs),
      slackThreadMapped: Boolean(command?.deliveryEvidence?.slackThreadMapped || command?.slackThreadTs || command?.slackMessageTs),
      photoUploaded: Boolean(command?.deliveryEvidence?.slackPhotoUploaded || fileReply || file),
      slackFileVisible: Boolean(command?.deliveryEvidence?.slackFileVisible || String(file?.file_access || "").trim() === "visible"),
      slackFileOpenOk: Boolean(command?.deliveryEvidence?.slackFileOpenOk),
      uploadNoticeSeen: Boolean(uploadNotice),
      firstWorkerReplyPosted: Boolean(workerReply),
      structuredExecutionAckPosted: Boolean(ackPayload),
      photoReadyTruePosted: ackPayload?.photo_ready === true,
      fileModeHosted: String(file?.mode || "").trim() === "hosted",
      fileAccessVisible: String(file?.file_access || "").trim() === "visible"
    }
  };
}

function classifyFailureBoundary(command) {
  const stopPoint = String(command?.deliveryStopPoint || "").trim();

  if (!stopPoint) {
    return "unknown";
  }

  if (
    stopPoint === "slack_thread_missing"
    || stopPoint === "slack_photo_uploaded_missing"
    || stopPoint === "slack_file_open_failed"
  ) {
    return "links-side";
  }

  if (
    stopPoint === "worker_reply_missing"
    || stopPoint === "worker_ack_missing"
    || stopPoint === "worker_photo_ready_missing"
  ) {
    return "external-worker-side";
  }

  return "mixed-or-late";
}

async function runMaintenance(commandId) {
  if (!LINKS_WRITE_TOKEN) {
    return null;
  }

  const response = await fetch(`${BASE_URL}/api/admin/commands-maintenance`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-write-token": LINKS_WRITE_TOKEN
    },
    body: JSON.stringify({
      commandId,
      syncReplies: true
    })
  });

  return response.json().catch(() => ({}));
}

async function postCommand() {
  const response = await fetch(`${BASE_URL}/api/commands`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({
      clientId,
      threadId: TARGET_PROJECT_ID,
      threadLabel: TARGET_PROJECT_LABEL,
      projectId: TARGET_PROJECT_ID,
      dispatchMode: "cloud",
      targetExecutionMode: "cloud",
      targetRepo: TARGET_REPO,
      targetRepoUrl: TARGET_REPO_URL,
      targetContextFiles: TARGET_CONTEXT_FILES,
      text,
      photo: {
        contentType: "image/png",
        fileName: "cloud-photo-smoke.png",
        size: 68,
        dataUrl: photoDataUrl
      }
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.command?.id) {
    throw new Error(String(data?.error || "").trim() || `POST /api/commands failed with ${response.status}`);
  }

  assertManifestContext(data.command, "cloud photo create");

  if (String(data.command?.dispatchMode || "").trim() !== "slack-codex-cloud") {
    throw new Error(`cloud photo create: expected dispatchMode=slack-codex-cloud, got ${String(data.command?.dispatchMode || "").trim() || "empty"}.`);
  }

  return data.command;
}

async function pollCommand(id) {
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < 240000) {
    await runMaintenance(id).catch(() => null);
    const response = await fetch(`${BASE_URL}/api/commands?id=${encodeURIComponent(id)}`, {
      headers: { accept: "application/json" }
    });
    const data = await response.json().catch(() => ({}));
    const command = data?.command || null;

    if (command) {
      assertManifestContext(command, "cloud photo poll");
      const status = String(command.status || "").trim().toLowerCase();
      console.log(`status=${status || "unknown"} stage=${String(command.progressStage || "").trim() || "unknown"} dispatchMode=${String(command.dispatchMode || "").trim() || "unknown"}`);

      if (status === "answered") {
        const replies = await fetchAssistantReplies(command.id);
        const matched = replies.find((reply) => /PHOTO_OK/i.test(String(reply?.text || "")));

        if (!matched) {
          throw new Error("Cloud photo smoke answered, but PHOTO_OK reply was not found.");
        }

        if (String(command.actualExecutor || "").trim() !== "cloud") {
          throw new Error(`Cloud photo smoke expected actualExecutor=cloud, got ${String(command.actualExecutor || "").trim() || "empty"}.`);
        }

        return command;
      }

      if (
        String(command?.slackChannelId || "").trim()
        && String(command?.slackThreadTs || command?.slackMessageTs || "").trim()
        && SLACK_BOT_TOKEN
      ) {
        const replies = await fetchSlackThreadReplies(
          String(command.slackChannelId || "").trim(),
          String(command.slackThreadTs || command.slackMessageTs || "").trim()
        );
        const fileReply = replies.find((reply) => Array.isArray(reply?.files) && reply.files.length > 0);
        const fileId = String(command?.routeAttempts?.at?.(-1)?.photoFileId || fileReply?.files?.[0]?.id || "").trim();
        const file = fileId ? await fetchSlackFileInfo(fileId).catch(() => null) : null;
        const ack = replies.find((reply) => {
          const payload = parseExecutionAck(String(reply?.text || ""));
          return payload && payload.photo_ready === true;
        });
        const matched = replies.find((reply) => /PHOTO_OK/i.test(String(reply?.text || "")));
        const summary = summarizeSlackDelivery(command, replies, file);

        console.log(JSON.stringify(summary, null, 2));
        console.log(JSON.stringify({
          stopPoint: String(command?.deliveryStopPoint || "").trim() || "none",
          failureBoundary: classifyFailureBoundary(command)
        }, null, 2));

        if (file) {
          const probe = await probeSlackFile(file).catch(() => ({ ok: false, status: 0 }));
          console.log(JSON.stringify({
            fileId: String(file.id || "").trim(),
            fileMode: String(file.mode || "").trim(),
            fileAccess: String(file.file_access || "").trim(),
            fileProbe: probe
          }, null, 2));
        }

        if (!command.firstExecutorAckSeenAt && ack) {
          throw new Error("Structured photo execution ack appeared in Slack, but command state still has no firstExecutorAckSeenAt.");
        }

        if (matched && ack) {
          return command;
        }
      }

      if (status === "failed") {
        console.log(JSON.stringify({
          stopPoint: String(command?.deliveryStopPoint || "").trim() || "none",
          evidence: command?.deliveryEvidence || null,
          failureBoundary: classifyFailureBoundary(command)
        }, null, 2));
        throw new Error(String(command.errorMessage || "Cloud photo smoke failed."));
      }
    }

    await sleep(5000);
  }

  throw new Error("Cloud photo smoke timed out waiting for both structured photo execution ack and PHOTO_OK reply.");
}

async function main() {
  console.log(`Submitting cloud photo smoke command to ${BASE_URL}`);
  const command = await postCommand();
  console.log(`commandId=${command.id}`);
  const answered = await pollCommand(command.id);
  console.log(`Cloud photo smoke OK: command ${answered.id} answered via stage=${answered.progressStage || "unknown"} dispatchMode=${answered.dispatchMode || "unknown"}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
