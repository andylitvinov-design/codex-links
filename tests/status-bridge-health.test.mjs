import test from "node:test";
import assert from "node:assert/strict";

import { deriveBridgeStatusFromCommands, readBridgeStatus, writeBridgeStatus } from "../functions/_lib/status.js";
import { writeCommands } from "../functions/_lib/commands.js";

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

test("readBridgeStatus does not report bridgeOnline for manual fresh heartbeats", async () => {
  const env = createMockEnv();

  await writeBridgeStatus(env, {
    dispatchMode: "local-bridge",
    localBridge: {
      online: true,
      managedBy: "manual",
      lastRunAt: new Date().toISOString(),
      state: "running"
    }
  });

  const status = await readBridgeStatus(env);
  assert.equal(status.localBridge.online, true);
  assert.equal(status.localBridge.managedBy, "manual");
  assert.equal(status.bridgeOnline, false);
});

test("readBridgeStatus reports bridgeOnline only for fresh launchd-managed heartbeats", async () => {
  const env = createMockEnv();

  await writeBridgeStatus(env, {
    dispatchMode: "local-bridge",
    localBridge: {
      online: true,
      managedBy: "launchd",
      lastRunAt: new Date().toISOString(),
      state: "running"
    }
  });

  const status = await readBridgeStatus(env);
  assert.equal(status.localBridge.online, true);
  assert.equal(status.localBridge.managedBy, "launchd");
  assert.equal(status.bridgeOnline, true);
});

test("deriveBridgeStatusFromCommands exposes stable route health", async () => {
  const env = {
    ...createMockEnv(),
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_CODEX_CHANNEL_ID: "C123",
    SLACK_CODEX_USER_ID: "U999",
    OPENAI_API_KEY: "sk-test"
  };
  const now = new Date().toISOString();

  await writeBridgeStatus(env, {
    dispatchMode: "slack-codex-cloud",
    slackActor: {
      configuredUserId: "U999",
      validationStatus: "validated",
      lastValidatedAt: now
    },
    localBridge: {
      online: true,
      managedBy: "launchd",
      lastRunAt: now,
      lastSuccessAt: now,
      state: "idle"
    },
    claudeBridge: {
      online: true,
      lastRunAt: now,
      lastSuccessAt: now,
      state: "idle"
    }
  });
  await writeCommands(env, [{
    id: "cmd-cloud",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "probe",
    createdAt: now,
    progressUpdatedAt: now,
    dispatchMode: "slack-codex-cloud",
    requestedExecutor: "cloud-via-slack",
    status: "queued",
    progressStage: "queued"
  }]);

  const status = await deriveBridgeStatusFromCommands(env);
  assert.equal(status.routes.cloudViaSlack.state, "healthy");
  assert.equal(status.routes.cloudViaSlack.enabled, true);
  assert.equal(status.routes.cloudViaSlack.pendingCount, 1);
  assert.equal(status.routes.directOpenai.state, "healthy");
  assert.equal(status.routes.localBridge.state, "healthy");
  assert.equal(status.routes.claudeBridge.state, "healthy");
});
