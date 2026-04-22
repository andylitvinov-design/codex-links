import test from "node:test";
import assert from "node:assert/strict";

import {
  claimNextCommand,
  updateCommandProgress,
  writeCommands
} from "../functions/_lib/commands.js";
import {
  COMMAND_ITEM_PREFIX,
  COMMAND_LOCAL_PROCESSING_STORAGE_KEY,
  COMMAND_LOCAL_QUEUE_STORAGE_KEY
} from "../functions/_lib/constants.js";

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

test("claimNextCommand recomputes active thread locks from a fresh snapshot when indexes are stale", async () => {
  const env = createMockEnv();
  const nowIso = new Date().toISOString();

  await writeCommands(env, [{
    id: "cmd-live-queued",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "deliver pending command",
    createdAt: nowIso,
    progressUpdatedAt: nowIso,
    dispatchMode: "local-bridge",
    requestedExecutor: "bridge",
    actualExecutor: "",
    status: "queued",
    progressStage: "queued"
  }]);

  await env.LINKS_STORE.put(COMMAND_LOCAL_QUEUE_STORAGE_KEY, JSON.stringify([]));
  await env.LINKS_STORE.put(COMMAND_LOCAL_PROCESSING_STORAGE_KEY, JSON.stringify(["cmd-stale-processing-index"]));
  await env.LINKS_STORE.put(`${COMMAND_ITEM_PREFIX}cmd-stale-processing-index`, JSON.stringify({
    id: "cmd-stale-processing-index",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "stale indexed processing command",
    createdAt: nowIso,
    progressUpdatedAt: nowIso,
    dispatchMode: "local-bridge",
    requestedExecutor: "bridge",
    actualExecutor: "bridge",
    status: "answered",
    progressStage: "done",
    processingLeaseUntil: new Date(Date.now() + 60_000).toISOString()
  }));

  const claimed = await claimNextCommand(env, {
    processorId: "test-bridge",
    leaseMs: 30_000
  });

  assert.equal(claimed.ok, true);
  assert.ok(claimed.value);
  assert.equal(claimed.value.id, "cmd-live-queued");
  assert.equal(claimed.value.status, "processing");
});

test("updateCommandProgress retries transient KV write rate limits", async () => {
  const store = new Map();
  let putAttempts = 0;
  let failNextPut = false;
  const env = {
    KV_WRITE_MAX_RETRIES: "2",
    KV_WRITE_RETRY_DELAY_MS: "0",
    LINKS_STORE: {
      async get(key, type) {
        if (!store.has(key)) {
          return null;
        }

        const value = store.get(key);
        return type === "json" ? JSON.parse(value) : value;
      },
      async put(key, value) {
        putAttempts += 1;

        if (failNextPut) {
          failNextPut = false;
          throw new Error("KV PUT failed: 429 Too Many Requests");
        }

        store.set(key, String(value));
      },
      async delete(key) {
        store.delete(key);
      }
    }
  };

  const nowIso = new Date().toISOString();

  await writeCommands(env, [{
    id: "cmd-progress-retry",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "deliver pending command",
    createdAt: nowIso,
    progressUpdatedAt: nowIso,
    dispatchMode: "local-bridge",
    requestedExecutor: "bridge",
    actualExecutor: "bridge",
    status: "processing",
    progressStage: "waiting-for-codex",
    processorId: "test-bridge",
    processingStartedAt: nowIso
  }]);

  putAttempts = 0;
  failNextPut = true;

  const updated = await updateCommandProgress(env, {
    id: "cmd-progress-retry",
    progressStage: "heartbeat",
    expectedProcessorId: "test-bridge"
  });

  assert.equal(updated.ok, true);
  assert.equal(updated.value?.progressStage, "heartbeat");
  assert.ok(putAttempts >= 2);
});
