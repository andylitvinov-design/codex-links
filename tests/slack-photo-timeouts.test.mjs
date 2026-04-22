import test from "node:test";
import assert from "node:assert/strict";

import { runCommandMaintenance, writeCommands } from "../functions/_lib/commands.js";

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

test("runCommandMaintenance keeps photo Slack commands alive during the longer first-ack window", async () => {
  const env = createMockEnv();
  const staleIso = new Date(Date.now() - 45_000).toISOString();

  await writeCommands(env, [{
    id: "cmd-slack-photo-no-ack-yet",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "Что на фото?",
    createdAt: staleIso,
    progressUpdatedAt: staleIso,
    dispatchMode: "slack-codex-cloud",
    requestedExecutor: "cloud-via-slack",
    actualExecutor: "",
    status: "dispatched",
    progressStage: "dispatched",
    slackDispatchAttempted: true,
    slackDispatchSucceeded: true,
    slackPostedAt: staleIso,
    dispatchedAt: staleIso,
    photoAttached: true,
    photoBytesPresent: true,
    fallbackCount: 1,
    fallbackApplied: true,
    fallbackReason: "local bridge did not claim the command in time",
    lastDiagnosticCode: "bridge_claim_timeout"
  }]);

  const result = await runCommandMaintenance(env, {
    fallbackToLocal: false,
    preferSlack: true
  });

  const updated = result.commands.find((command) => command.id === "cmd-slack-photo-no-ack-yet");
  assert.ok(updated);
  assert.equal(updated.status, "dispatched");
  assert.equal(updated.progressStage, "dispatched");
  assert.equal(updated.timeoutPhase, "");
  assert.equal(updated.lastDiagnosticCode, "bridge_claim_timeout");
});
