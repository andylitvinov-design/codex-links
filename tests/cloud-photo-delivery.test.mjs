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

test("postSlackCommand uploads photo through Slack thread without files:read", async () => {
  const originalFetch = globalThis.fetch;
  const uploadCalls = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);

    if (url === "https://slack.com/api/auth.test") {
      return Response.json({ ok: true, user_id: "U-BOT" });
    }

    if (url.startsWith("https://slack.com/api/conversations.members")) {
      return Response.json({ ok: true, members: ["U-WORKER"] });
    }

    if (url === "https://slack.com/api/chat.postMessage") {
      const body = JSON.parse(String(init.body || "{}"));

      if (body.thread_ts) {
        return Response.json({
          ok: true,
          channel: "C123",
          ts: "1776619001.000200",
          message: {
            ts: "1776619001.000200",
            thread_ts: body.thread_ts
          }
        });
      }

      return Response.json({
        ok: true,
        channel: "C123",
        ts: "1776619000.000100",
        message: {
          ts: "1776619000.000100"
        }
      });
    }

    if (url === "https://slack.com/api/files.getUploadURLExternal") {
      uploadCalls.push({
        url,
        contentType: String(init.headers?.["content-type"] || init.headers?.get?.("content-type") || ""),
        body: String(init.body)
      });

      return Response.json({
        ok: true,
        upload_url: "https://files.slack.com/upload/v1/test",
        file_id: "F123"
      });
    }

    if (url === "https://files.slack.com/upload/v1/test") {
      return new Response("OK - 68", { status: 200 });
    }

    if (url === "https://slack.com/api/files.completeUploadExternal") {
      const body = JSON.parse(String(init.body || "{}"));

      assert.equal(body.channel_id, "C123");
      assert.equal(body.thread_ts, "1776619000.000100");
      assert.equal(body.files[0].id, "F123");

      return Response.json({
        ok: true,
        files: [{
          id: "F123",
          title: "photo.png",
          mode: "hosted",
          file_access: "visible",
          url_private: "https://files.slack.com/files-pri/T123-F123/photo.png",
          url_private_download: "https://files.slack.com/files-pri/T123-F123/download/photo.png",
          permalink: "https://example.slack.com/files/U123/F123/photo.png"
        }]
      });
    }

    if (url === "https://files.slack.com/files-pri/T123-F123/download/photo.png") {
      return new Response(new Uint8Array([1]), { status: 200 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const published = await postSlackCommand({
      SLACK_BOT_TOKEN: "xoxb-test",
      SLACK_CODEX_CHANNEL_ID: "C123",
      SLACK_CODEX_USER_ID: "U-WORKER",
      SLACK_CODEX_MENTION: "<@U-WORKER>"
    }, {
      id: "cmd-1",
      threadId: "links",
      threadLabel: "links",
      text: "please inspect the image",
      projectId: "links",
      projectLabel: "links",
      projectCategory: "myprojects",
      targetRepo: "andylitvinov-design/codex-links",
      targetContextFiles: ["AGENTS.md", "README.md", "STATE.md"],
      photo: {
        fileName: "photo.png",
        contentType: "image/png",
        size: 68,
        dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sot7O8AAAAASUVORK5CYII="
      }
    }, "<@U-WORKER>");

    assert.equal(uploadCalls.length, 1);
    assert.equal(uploadCalls[0].contentType, "application/x-www-form-urlencoded");
    assert.match(uploadCalls[0].body, /filename=photo\.png/);
    assert.match(uploadCalls[0].body, /length=68/);
    assert.equal(published.photoUpload.fileId, "F123");
    assert.equal(published.photoUpload.fileAccess, "visible");
    assert.equal(published.photoUpload.botCanOpenFile, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST /api/commands keeps photo cloud requests on slack-codex-cloud when Slack upload succeeds", async () => {
  const env = createMockEnv({
    COMMAND_DISPATCH_MODE: "cloud-via-slack",
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_CODEX_CHANNEL_ID: "C123",
    SLACK_CODEX_USER_ID: "U-WORKER"
  });
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);

    if (url === "https://slack.com/api/auth.test") {
      return Response.json({ ok: true, user_id: "U-BOT" });
    }

    if (url.startsWith("https://slack.com/api/conversations.members")) {
      return Response.json({ ok: true, members: ["U-WORKER"] });
    }

    if (url === "https://slack.com/api/chat.postMessage") {
      const body = JSON.parse(String(init.body || "{}"));
      return Response.json({
        ok: true,
        channel: "C123",
        ts: body.thread_ts ? "1776619100.000200" : "1776619100.000100",
        message: {
          ts: body.thread_ts ? "1776619100.000200" : "1776619100.000100",
          thread_ts: body.thread_ts || "1776619100.000100"
        }
      });
    }

    if (url === "https://slack.com/api/files.getUploadURLExternal") {
      return Response.json({
        ok: true,
        upload_url: "https://files.slack.com/upload/v1/test",
        file_id: "F123"
      });
    }

    if (url === "https://files.slack.com/upload/v1/test") {
      return new Response("OK - 68", { status: 200 });
    }

    if (url === "https://slack.com/api/files.completeUploadExternal") {
      return Response.json({
        ok: true,
        files: [{
          id: "F123",
          title: "photo.png",
          mode: "hosted",
          file_access: "visible",
          url_private_download: "https://files.slack.com/files-pri/T123-F123/download/photo.png",
          permalink: "https://example.slack.com/files/U123/F123/photo.png"
        }]
      });
    }

    if (url === "https://files.slack.com/files-pri/T123-F123/download/photo.png") {
      return new Response(new Uint8Array([1]), { status: 200 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const response = await onRequest({
      request: new Request("https://example.com/api/commands", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          clientId: "test-client",
          threadId: "links",
          threadLabel: "links",
          text: "check photo cloud delivery",
          dispatchMode: "cloud",
          targetExecutionMode: "cloud",
          targetRepo: "andylitvinov-design/codex-links",
          targetRepoUrl: "https://github.com/andylitvinov-design/codex-links",
          targetContextFiles: ["AGENTS.md", "README.md", "STATE.md"],
          photo: {
            fileName: "photo.png",
            contentType: "image/png",
            size: 68,
            dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sot7O8AAAAASUVORK5CYII="
          }
        })
      }),
      env,
      waitUntil() {}
    });
    const data = await response.json();

    assert.equal(response.status, 201);
    assert.equal(String(data?.command?.dispatchMode || "").trim(), "slack-codex-cloud");
    assert.equal(Boolean(data?.command?.fallbackApplied), false);
    assert.equal(String(data?.command?.deliveryStopPoint || "").trim(), "slack_file_open_ok");
    assert.equal(Boolean(data?.command?.deliveryEvidence?.slackPhotoUploaded), true);
    assert.equal(Boolean(data?.command?.deliveryEvidence?.slackFileOpenOk), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("postSlackCommand preserves Slack invalid_arguments detail for photo upload failures", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);

    if (url === "https://slack.com/api/auth.test") {
      return Response.json({ ok: true, user_id: "U-BOT" });
    }

    if (url.startsWith("https://slack.com/api/conversations.members")) {
      return Response.json({ ok: true, members: ["U-WORKER"] });
    }

    if (url === "https://slack.com/api/chat.postMessage") {
      return Response.json({
        ok: true,
        channel: "C123",
        ts: "1776619200.000100",
        message: {
          ts: "1776619200.000100"
        }
      });
    }

    if (url === "https://slack.com/api/files.getUploadURLExternal") {
      return Response.json({
        ok: false,
        error: "invalid_arguments",
        response_metadata: {
          messages: [
            "[ERROR] missing required field: length",
            "[ERROR] missing required field: filename"
          ]
        }
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    await assert.rejects(
      () => postSlackCommand({
        SLACK_BOT_TOKEN: "xoxb-test",
        SLACK_CODEX_CHANNEL_ID: "C123",
        SLACK_CODEX_USER_ID: "U-WORKER"
      }, {
        id: "cmd-2",
        threadId: "links",
        threadLabel: "links",
        text: "please inspect the image",
        projectId: "links",
        projectLabel: "links",
        projectCategory: "myprojects",
        targetRepo: "andylitvinov-design/codex-links",
        targetContextFiles: ["AGENTS.md", "README.md", "STATE.md"],
        photo: {
          fileName: "photo.png",
          contentType: "image/png",
          size: 68,
          dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sot7O8AAAAASUVORK5CYII="
        }
      }, "<@U-WORKER>"),
      (error) => {
        assert.match(String(error?.message || ""), /invalid_arguments/);
        assert.match(String(error?.message || ""), /missing required field: length/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
