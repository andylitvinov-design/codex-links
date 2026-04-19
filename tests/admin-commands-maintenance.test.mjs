import test from "node:test";
import assert from "node:assert/strict";

import { onRequest } from "../functions/api/admin/commands-maintenance.js";
import { writeCommands } from "../functions/_lib/commands.js";

function createMockEnv() {
  const store = new Map();

  return {
    LINKS_WRITE_TOKEN: "test-token",
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

test("POST /api/admin/commands-maintenance reroutes stale bridge commands to trusted cloud when configured", async () => {
  const env = createMockEnv();
  env.CLOUD_BRIDGE_BASE_URL = "http://127.0.0.1:8788";
  env.CLOUD_BRIDGE_SHARED_SECRET = "secret";

  const staleIso = new Date(Date.now() - (3 * 60 * 1000)).toISOString();

  await writeCommands(env, [{
    id: "cmd-admin-reroute",
    clientId: "client-1",
    threadId: "links",
    threadLabel: "links",
    text: "fix the dialogs",
    createdAt: staleIso,
    progressUpdatedAt: staleIso,
    dispatchMode: "local-bridge",
    requestedExecutor: "bridge",
    actualExecutor: "bridge",
    status: "processing",
    progressStage: "waiting-for-codex",
    processingStartedAt: staleIso,
    processingLeaseUntil: new Date(Date.now() - 1000).toISOString(),
    targetRepo: "andylitvinov-design/codex-links",
    targetRepoUrl: "https://github.com/andylitvinov-design/codex-links",
    targetContextFiles: ["AGENTS.md", "README.md"],
    targetWorkspacePath: "/Users/andriilitvinov/projects/MYPROJECTS/links"
  }]);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);

    if (url === "http://127.0.0.1:8788/v1/commands") {
      assert.equal(String(init.method || "GET").toUpperCase(), "POST");
      return Response.json({
        ok: true,
        jobId: "job-admin-123",
        acceptedAt: "2026-04-19T12:00:00.000Z",
        progressMessage: "Trusted cloud bridge accepted the job."
      }, { status: 202 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const response = await onRequest({
      request: new Request("https://example.com/api/admin/commands-maintenance", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-write-token": "test-token"
        },
        body: JSON.stringify({
          commandId: "cmd-admin-reroute",
          syncReplies: false
        })
      }),
      env
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.summary.changed, true);
    assert.equal(payload.summary.changedCount, 1);
    assert.equal(payload.summary.dispatchedCount, 1);

    const command = payload.commands.find((entry) => entry.id === "cmd-admin-reroute");
    assert.ok(command);
    assert.equal(command.status, "processing");
    assert.equal(command.progressStage, "waiting");
    assert.equal(command.actualExecutor, "cloud");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
