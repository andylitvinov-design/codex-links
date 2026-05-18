import assert from "node:assert/strict";
import test from "node:test";

import { claimNextCommand, insertCommand } from "../functions/_lib/commands.js";
import {
  COMMAND_CODE_COPILOT_PROCESSING_STORAGE_KEY,
  COMMAND_CODE_COPILOT_QUEUE_STORAGE_KEY
} from "../functions/_lib/constants.js";
import { onRequest as sendEndpoint } from "../functions/api/prompt-router/send.js";

function createMemoryStore() {
  const store = new Map();
  return {
    async get(key, type) {
      const value = store.get(key);
      if (value === undefined) return null;
      return type === "json" ? JSON.parse(value) : value;
    },
    async put(key, value) {
      store.set(key, String(value));
    }
  };
}

function jsonRequest(body) {
  return new Request("https://codex-links.pages.dev/api/prompt-router/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function readJson(response) {
  return JSON.parse(await response.text());
}

const payload = {
  project: "finance",
  repo: "andylitvinov-design/finance",
  liveUrl: "https://ezohata-incoming-ledger.vercel.app",
  category: "Finance balance issue",
  problem: "Факт в аналитике показывает нули",
  prompt: "Repo: andylitvinov-design/finance\nFirst prove the failing layer before patching."
};

test("Prompt Router creates Code Copilot bridge command when enabled", async () => {
  const response = await sendEndpoint({
    request: jsonRequest({ ...payload, target: "code-copilot" }),
    env: {
      CODE_COPILOT_BRIDGE_ENABLED: "true",
      LINKS_STORE: createMemoryStore()
    }
  });
  const body = await readJson(response);

  assert.equal(body.ok, true);
  assert.equal(body.mode, "code-copilot-dispatch");
  assert.equal(body.target, "code-copilot");
  assert.ok(body.commandId);
  assert.equal(body.pollUrl, `/api/commands?id=${encodeURIComponent(body.commandId)}`);
});

test("Code Copilot bridge command can be claimed", async () => {
  const env = { LINKS_STORE: createMemoryStore() };
  const created = await insertCommand(env, {
    clientId: "test-client",
    threadId: "finance",
    text: "review this prompt",
    dispatchMode: "code-copilot-bridge",
    targetExecutionMode: "code-copilot",
    requestedExecutor: "code-copilot"
  });

  assert.equal(created.ok, true);
  assert.equal(created.value.dispatchMode, "code-copilot-bridge");
  assert.deepEqual(
    await env.LINKS_STORE.get(COMMAND_CODE_COPILOT_QUEUE_STORAGE_KEY, "json"),
    [created.value.id]
  );

  const claimed = await claimNextCommand(env, {
    processorId: "code-copilot-test",
    dispatchMode: "code-copilot-bridge",
    textOnly: true
  });

  assert.equal(claimed.ok, true);
  assert.equal(claimed.value.id, created.value.id);
  assert.equal(claimed.value.status, "processing");
  assert.equal(claimed.value.dispatchMode, "code-copilot-bridge");
  assert.equal(claimed.value.actualExecutor, "code-copilot");
  assert.equal(claimed.value.actualDispatchMode, "code-copilot");
  assert.deepEqual(await env.LINKS_STORE.get(COMMAND_CODE_COPILOT_QUEUE_STORAGE_KEY, "json"), []);
  assert.deepEqual(
    await env.LINKS_STORE.get(COMMAND_CODE_COPILOT_PROCESSING_STORAGE_KEY, "json"),
    [created.value.id]
  );
});
