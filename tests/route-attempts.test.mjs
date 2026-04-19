import test from "node:test";
import assert from "node:assert/strict";

import {
  markCommandDispatched,
  rerouteCommandToLocalBridge,
  writeCommands
} from "../functions/_lib/commands.js";

function createMockEnv() {
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
    }
  };
}

test("route attempts preserve initial Slack trace when falling back to bridge", async () => {
  const env = createMockEnv();
  const createdAt = new Date().toISOString();

  await writeCommands(env, [{
    id: "cmd-route-history",
    clientId: "client-1",
    threadId: "links",
    threadLabel: "links",
    text: "inspect the photo",
    createdAt,
    progressUpdatedAt: createdAt,
    dispatchMode: "slack-codex-cloud",
    status: "queued",
    progressStage: "queued",
    targetRepo: "andylitvinov-design/codex-links"
  }]);

  await markCommandDispatched(env, {
    id: "cmd-route-history",
    dispatchMode: "slack-codex-cloud",
    progressStage: "dispatched",
    slackChannelId: "C123",
    slackMessageTs: "111.222",
    slackThreadTs: "111.222",
    photoFileId: "F123",
    photoPermalink: "https://example.com/file"
  });

  const rerouted = await rerouteCommandToLocalBridge(env, {
    id: "cmd-route-history",
    progressStage: "switched-to-bridge",
    fallbackReason: "execution ack timed out",
    lastDiagnosticCode: "cloud_execution_ack_timeout",
    lastDiagnosticDetail: "Cloud did not send a structured execution ack in time."
  });

  assert.equal(rerouted.ok, true);
  assert.equal(Array.isArray(rerouted.value.routeAttempts), true);
  assert.equal(rerouted.value.routeAttempts.length, 2);

  const [initialAttempt, fallbackAttempt] = rerouted.value.routeAttempts;
  assert.equal(initialAttempt.mode, "slack-codex-cloud");
  assert.equal(initialAttempt.stage, "dispatched");
  assert.equal(initialAttempt.slackChannelId, "C123");
  assert.equal(initialAttempt.slackThreadTs, "111.222");
  assert.equal(initialAttempt.photoFileId, "F123");

  assert.equal(fallbackAttempt.mode, "local-bridge");
  assert.equal(fallbackAttempt.stage, "switched-to-bridge");
  assert.equal(fallbackAttempt.slackChannelId, "C123");
  assert.equal(fallbackAttempt.slackThreadTs, "111.222");
  assert.equal(fallbackAttempt.fallbackReason, "execution ack timed out");
  assert.equal(fallbackAttempt.diagnosticCode, "cloud_execution_ack_timeout");
});
