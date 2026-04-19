import test from "node:test";
import assert from "node:assert/strict";

import { buildPhotoDeliveryTimeout, onRequest } from "../functions/api/commands.js";

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
