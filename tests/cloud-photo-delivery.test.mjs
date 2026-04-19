import test from "node:test";
import assert from "node:assert/strict";

import { buildPhotoDeliveryTimeout, onRequest } from "../functions/api/commands.js";
import { postSlackCommand } from "../functions/_lib/slack.js";

function createMockEnv(overrides = {}) {
  const store = new Map();

  return {
    LINKS_STORE: {
      async get(key, type) {
        if (!store.has(key)) {
          return null;
        }

        const value = store.get(key);
        return type === "json" ? JSON.parse(value) : value;
      },
      async put(key, value) {
        store.set(key, String(value));
      },
      async delete(key) {
        store.delete(key);
      }
    },
    ...overrides
  };
}

test("photo timeout stops at worker_reply_missing when Slack file is readable", () => {
  const timeout = buildPhotoDeliveryTimeout({}, {
    slackRootPosted: true,
    slackThreadMapped: true,
    slackPhotoUploaded: true,
    slackFileVisible: true,
    slackFileOpenOk: true,
    threadRootSeen: true,
    fileReplySeen: true,
    fileId: "F123",
    fileMode: "hosted",
    fileAccess: "visible",
    botCanOpenFile: true,
    botOpenHttpStatus: 200,
    workerReplySeen: false,
    workerAckSeen: false,
    workerPhotoReadySeen: false,
    executionAckSeen: false,
    photoReadySeen: false
  }, Date.now());

  assert.equal(timeout.deliveryStopPoint, "worker_reply_missing");
  assert.equal(timeout.lastDiagnosticCode, "worker_reply_missing");
});

test("POST /api/commands dispatches synchronously without waitUntil watcher", async () => {
  const env = createMockEnv();
  let waitUntilCalls = 0;
  const request = new Request("https://example.com/api/commands", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      clientId: "test-client",
      threadId: "links",
      threadLabel: "links",
      text: "check delivery path"
    })
  });

  const response = await onRequest({
    request,
    env,
    waitUntil() {
      waitUntilCalls += 1;
    }
  });
  const data = await response.json();

  assert.equal(response.status, 201);
  assert.equal(waitUntilCalls, 0);
  assert.equal(Boolean(data?.command?.id), true);
  assert.equal(String(data?.command?.dispatchMode || "").trim(), "local-bridge");
});

test("postSlackCommand completes photo upload without thread-specific completeUpload args", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, options = {}) => {
    requests.push({
      url: String(url),
      method: String(options.method || "GET").toUpperCase(),
      headers: new Headers(options.headers || {}),
      body: typeof options.body === "string" ? options.body : options.body
    });

    if (String(url) === "https://slack.com/api/chat.postMessage") {
      const payload = JSON.parse(String(options.body || "{}"));
      if (String(payload.thread_ts || "").trim()) {
        return new Response(JSON.stringify({ ok: true, channel: payload.channel, ts: "1710000000.000200" }), { status: 200 });
      }

      return new Response(JSON.stringify({
        ok: true,
        channel: payload.channel,
        ts: "1710000000.000100",
        message: { thread_ts: "1710000000.000100" }
      }), { status: 200 });
    }

    if (String(url) === "https://slack.com/api/files.getUploadURLExternal") {
      return new Response(JSON.stringify({
        ok: true,
        upload_url: "https://uploads.slack.test/file",
        file_id: "F123"
      }), { status: 200 });
    }

    if (String(url) === "https://uploads.slack.test/file") {
      return new Response("ok", { status: 200 });
    }

    if (String(url) === "https://slack.com/api/files.completeUploadExternal") {
      return new Response(JSON.stringify({
        ok: true,
        files: [{
          id: "F123",
          permalink: "https://slack-files.test/F123",
          mode: "hosted",
          file_access: "visible",
          url_private_download: "https://slack-files.test/F123/download"
        }]
      }), { status: 200 });
    }

    if (String(url) === "https://slack-files.test/F123/download") {
      return new Response("binary", { status: 200 });
    }

    throw new Error(`Unexpected fetch: ${String(url)}`);
  };

  try {
    const result = await postSlackCommand({
      SLACK_BOT_TOKEN: "xoxb-test",
      SLACK_CODEX_CHANNEL_ID: "C123"
    }, {
      id: "cmd-1",
      text: "inspect photo",
      photo: {
        fileName: "photo.png",
        contentType: "image/png",
        dataUrl: "data:image/png;base64,AA==",
        size: 1
      }
    }, "<@U123>");

    assert.equal(result.photoUpload?.fileId, "F123");
    assert.equal(result.photoUpload?.permalink, "https://slack-files.test/F123");

    const getUploadRequest = requests.find((entry) => entry.url === "https://slack.com/api/files.getUploadURLExternal");
    const completeRequest = requests.find((entry) => entry.url === "https://slack.com/api/files.completeUploadExternal");

    assert.ok(getUploadRequest);
    assert.ok(completeRequest);
    assert.match(String(getUploadRequest.headers.get("content-type") || ""), /application\/x-www-form-urlencoded/i);
    assert.match(String(completeRequest.headers.get("content-type") || ""), /application\/x-www-form-urlencoded/i);
    assert.match(String(getUploadRequest.body || ""), /filename=photo\.png/);
    assert.match(String(completeRequest.body || ""), /channel_id=C123/);
    assert.doesNotMatch(String(completeRequest.body || ""), /thread_ts=/);
    assert.doesNotMatch(String(completeRequest.body || ""), /initial_comment=/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("postSlackCommand surfaces compact upload diagnostics on completeUpload failure", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options = {}) => {
    if (String(url) === "https://slack.com/api/chat.postMessage") {
      const payload = JSON.parse(String(options.body || "{}"));
      return new Response(JSON.stringify({
        ok: true,
        channel: payload.channel,
        ts: "1710000000.000100",
        message: { thread_ts: "1710000000.000100" }
      }), { status: 200 });
    }

    if (String(url) === "https://slack.com/api/files.getUploadURLExternal") {
      return new Response(JSON.stringify({
        ok: true,
        upload_url: "https://uploads.slack.test/file",
        file_id: "F123"
      }), { status: 200 });
    }

    if (String(url) === "https://uploads.slack.test/file") {
      return new Response("ok", { status: 200 });
    }

    if (String(url) === "https://slack.com/api/files.completeUploadExternal") {
      return new Response(JSON.stringify({ ok: false, error: "invalid_arguments" }), { status: 200 });
    }

    throw new Error(`Unexpected fetch: ${String(url)}`);
  };

  try {
    await assert.rejects(
      () => postSlackCommand({
        SLACK_BOT_TOKEN: "xoxb-test",
        SLACK_CODEX_CHANNEL_ID: "C123"
      }, {
        id: "cmd-2",
        text: "inspect photo",
        photo: {
          fileName: "photo.png",
          contentType: "image/png",
          dataUrl: "data:image/png;base64,AA==",
          size: 1
        }
      }, "<@U123>"),
      (error) => {
        assert.equal(error?.commandError?.code, "slack_photo_upload_failed");
        assert.equal(error?.commandError?.deliveryStopPoint, "slack_thread_mapped");
        assert.equal(error?.commandError?.deliveryEvidence?.slackUploadMethod, "files.completeUploadExternal");
        assert.equal(error?.commandError?.deliveryEvidence?.slackUploadArgKeys, "files,channel_id");
        assert.equal(error?.commandError?.deliveryEvidence?.slackUploadError, "invalid_arguments");
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
