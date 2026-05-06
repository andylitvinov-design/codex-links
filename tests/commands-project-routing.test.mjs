import test from "node:test";
import assert from "node:assert/strict";

import { onRequest } from "../functions/api/commands.js";
import { getCommandById } from "../functions/_lib/commands.js";

function createMockEnv() {
  const store = new Map();

  return {
    COMMAND_DISPATCH_MODE: "local-bridge",
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

function createPostContext(env, payload) {
  const waitUntilPromises = [];

  return {
    request: new Request("https://codex-links.test/api/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }),
    env,
    waitUntil(promise) {
      waitUntilPromises.push(Promise.resolve(promise).catch(() => null));
    },
    waitUntilPromises
  };
}

test("command creation preserves projectKey and Codex environment metadata", async () => {
  const env = createMockEnv();
  const context = createPostContext(env, {
    clientId: "client-project-routing",
    threadId: "links",
    projectKey: "reiki-yggdrasil",
    text: "Audit current routing metadata.",
    dispatchMode: "local-bridge"
  });

  const response = await onRequest(context);
  const data = await response.json();

  assert.equal(response.status, 201);
  assert.equal(data.command.projectKey, "reiki-yggdrasil");
  assert.equal(data.command.projectId, "reiki-yggdrasil");
  assert.equal(data.command.targetRepo, "andylitvinov-design/reiki-yggdrasil");
  assert.equal(data.command.targetRepoUrl, "https://github.com/andylitvinov-design/reiki-yggdrasil");
  assert.equal(data.command.codexEnvironmentName, "reiki-yggdrasil");
  assert.equal(data.command.codexEnvironmentId, "needs-verification");
  assert.equal(data.command.codexEnvironmentVerified, false);
  assert.equal(data.command.defaultBranch, "main");
  assert.deepEqual(data.command.allowedActions, ["audit", "fix", "test", "design-check"]);

  const stored = await getCommandById(env, data.command.id);
  assert.equal(stored.projectKey, "reiki-yggdrasil");
  assert.equal(stored.targetRepo, "andylitvinov-design/reiki-yggdrasil");

  const detailResponse = await onRequest({
    request: new Request(`https://codex-links.test/api/commands?id=${data.command.id}`),
    env,
    waitUntil() {}
  });
  const detailData = await detailResponse.json();

  assert.equal(detailResponse.status, 200);
  assert.equal(detailData.command.projectKey, "reiki-yggdrasil");
  assert.equal(detailData.command.codexEnvironmentName, "reiki-yggdrasil");
  assert.deepEqual(detailData.command.allowedActions, ["audit", "fix", "test", "design-check"]);
});

test("unknown project is rejected before command dispatch", async () => {
  const env = createMockEnv();
  const context = createPostContext(env, {
    clientId: "client-project-routing",
    threadId: "links",
    projectKey: "missing-project",
    text: "Run a cloud task.",
    dispatchMode: "local-bridge"
  });

  const response = await onRequest(context);
  const data = await response.json();

  assert.equal(response.status, 400);
  assert.match(data.error, /dispatch manifest/i);
});
