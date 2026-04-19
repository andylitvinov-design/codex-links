import test from "node:test";
import assert from "node:assert/strict";

import { onRequest } from "../functions/api/public-config.js";

function createMockEnv() {
  return {
    LINKS_STORE: {
      async get() {
        return null;
      }
    }
  };
}

test("GET /api/public-config exposes only safe trusted cloud bridge availability fields", async () => {
  const env = createMockEnv();
  env.CLOUD_BRIDGE_BASE_URL = "http://127.0.0.1:8788";
  env.CLOUD_BRIDGE_SHARED_SECRET = "super-secret";
  env.CLOUD_BRIDGE_LABEL = "Trusted Codex Cloud";

  const response = await onRequest({
    request: new Request("https://example.com/api/public-config"),
    env
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.cloud.enabled, true);
  assert.equal(payload.cloud.label, "Trusted Codex Cloud");
  assert.equal("CLOUD_BRIDGE_BASE_URL" in payload, false);
  assert.equal("CLOUD_BRIDGE_SHARED_SECRET" in payload, false);
});
