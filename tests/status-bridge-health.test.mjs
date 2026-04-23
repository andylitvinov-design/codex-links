import test from "node:test";
import assert from "node:assert/strict";

import { readBridgeStatus, writeBridgeStatus } from "../functions/_lib/status.js";

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
