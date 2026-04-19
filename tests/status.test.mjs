import test from "node:test";
import assert from "node:assert/strict";

import { BRIDGE_STATUS_STORAGE_KEY } from "../functions/_lib/constants.js";
import { readBridgeStatus } from "../functions/_lib/status.js";

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
      }
    }
  };
}

test("readBridgeStatus rewrites legacy slack cloud status to trusted cloud when bridge is configured", async () => {
  const env = createMockEnv();
  env.CLOUD_BRIDGE_BASE_URL = "http://127.0.0.1:8788";
  env.CLOUD_BRIDGE_SHARED_SECRET = "secret";

  await env.LINKS_STORE.put(BRIDGE_STATUS_STORAGE_KEY, JSON.stringify({
    bridgeOnline: false,
    state: "running",
    dispatchMode: "slack-codex-cloud",
    executorLabel: "Codex Cloud via Slack"
  }));

  const status = await readBridgeStatus(env);

  assert.equal(status.dispatchMode, "cloud");
  assert.equal(status.executorLabel, "Trusted Codex Cloud");
});

test("readBridgeStatus rewrites local bridge status to trusted cloud when bridge is configured", async () => {
  const env = createMockEnv();
  env.CLOUD_BRIDGE_BASE_URL = "https://bridge.codex-links.example.com";
  env.CLOUD_BRIDGE_SHARED_SECRET = "secret";

  await env.LINKS_STORE.put(BRIDGE_STATUS_STORAGE_KEY, JSON.stringify({
    bridgeOnline: true,
    state: "running",
    dispatchMode: "local-bridge",
    executorLabel: "Local bridge"
  }));

  const status = await readBridgeStatus(env);

  assert.equal(status.dispatchMode, "cloud");
  assert.equal(status.executorLabel, "Trusted Codex Cloud");
});
