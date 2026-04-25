import test from "node:test";
import assert from "node:assert/strict";

import { onRequest } from "../functions/api/commands.js";
import { getCommandById, writeCommands } from "../functions/_lib/commands.js";
import { evaluateCloudDeliveryCommand } from "../scripts/_lib/cloud-guardian.mjs";

function createMockEnv() {
  const store = new Map();

  return {
    LINKS_WRITE_TOKEN: "secret",
    COMMAND_DISPATCH_MODE: "cloud-via-slack",
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_CODEX_CHANNEL_ID: "C123",
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

test("delivery-update requires write token", async () => {
  const env = createMockEnv();
  const createdAt = new Date().toISOString();

  await writeCommands(env, [{
    id: "cmd-delivery-auth",
    clientId: "client",
    threadId: "links",
    threadLabel: "links",
    text: "fix production",
    createdAt,
    progressUpdatedAt: createdAt,
    dispatchMode: "slack-codex-cloud",
    status: "answered",
    progressStage: "answered"
  }]);

  const response = await onRequest({
    env,
    request: new Request("https://example.test/api/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "delivery-update",
        id: "cmd-delivery-auth",
        deliveryStatus: "production-verified"
      })
    })
  });

  assert.equal(response.status, 401);
});

test("delivery-update persists production delivery fields", async () => {
  const env = createMockEnv();
  const createdAt = new Date().toISOString();

  await writeCommands(env, [{
    id: "cmd-delivery-update",
    clientId: "client",
    threadId: "links",
    threadLabel: "links",
    text: "fix production",
    createdAt,
    progressUpdatedAt: createdAt,
    dispatchMode: "slack-codex-cloud",
    status: "answered",
    progressStage: "answered"
  }]);

  const response = await onRequest({
    env,
    request: new Request("https://example.test/api/commands", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-write-token": "secret"
      },
      body: JSON.stringify({
        action: "delivery-update",
        id: "cmd-delivery-update",
        deliveryStatus: "production-verified",
        mergeCommit: "abcdef123456",
        productionUrl: "https://codex-links.pages.dev/",
        productionVerifiedAt: "2026-04-25T12:00:00.000Z",
        desktopMirrorStatus: "mirrored",
        desktopMirroredAt: "2026-04-25T12:01:00.000Z",
        desktopMirrorThreadId: "thr_reports"
      })
    })
  });

  assert.equal(response.status, 200);

  const updated = await getCommandById(env, "cmd-delivery-update");
  assert.equal(updated.deliveryStatus, "production-verified");
  assert.equal(updated.mergeCommit, "abcdef123456");
  assert.equal(updated.productionUrl, "https://codex-links.pages.dev/");
  assert.equal(updated.productionVerifiedAt, "2026-04-25T12:00:00.000Z");
  assert.equal(updated.desktopMirrorStatus, "mirrored");
  assert.equal(updated.desktopMirrorThreadId, "thr_reports");
});

test("guardian marks merged PR with passing smoke as production verified", () => {
  const decision = evaluateCloudDeliveryCommand({
    id: "cmd-verified",
    text: "fix production",
    dispatchMode: "slack-codex-cloud",
    status: "answered",
    progressStage: "answered",
    prUrl: "https://github.com/example/repo/pull/1",
    productionVerifiable: true,
    deploy: { productionUrl: "https://example.pages.dev/" }
  }, {
    pr: {
      url: "https://github.com/example/repo/pull/1",
      merged: true,
      mergeCommit: "abcdef123456"
    },
    smoke: {
      ok: true,
      url: "https://example.pages.dev/"
    }
  }, {
    nowIso: "2026-04-25T12:00:00.000Z"
  });

  assert.equal(decision.action, "update");
  assert.equal(decision.update.deliveryStatus, "production-verified");
  assert.equal(decision.update.mergeCommit, "abcdef123456");
  assert.equal(decision.update.productionVerifiedAt, "2026-04-25T12:00:00.000Z");
  assert.match(decision.report, /Production smoke check passed/);
});

test("guardian requests fallback when no PR appears before timeout", () => {
  const decision = evaluateCloudDeliveryCommand({
    id: "cmd-no-pr",
    text: "fix production",
    dispatchMode: "slack-codex-cloud",
    status: "processing",
    progressStage: "processing",
    dispatchedAt: "2026-04-25T10:00:00.000Z",
    productionVerifiable: true,
    deploy: { productionUrl: "https://example.pages.dev/" }
  }, {}, {
    nowIso: "2026-04-25T12:00:00.000Z"
  });

  assert.equal(decision.action, "fallback");
  assert.equal(decision.update.deliveryStatus, "fallback-running");
  assert.equal(decision.update.lastDiagnosticCode, "cloud_pr_timeout");
});

test("guardian blocks merged PR when production smoke fails", () => {
  const decision = evaluateCloudDeliveryCommand({
    id: "cmd-smoke-failed",
    text: "fix production",
    dispatchMode: "slack-codex-cloud",
    status: "answered",
    progressStage: "answered",
    prUrl: "https://github.com/example/repo/pull/1",
    resultAt: "2026-04-25T11:00:00.000Z",
    productionVerifiable: true,
    deploy: { productionUrl: "https://example.pages.dev/" }
  }, {
    pr: {
      merged: true,
      mergeCommit: "abcdef123456"
    },
    smoke: {
      ok: false,
      error: "Smoke returned HTTP 500."
    }
  }, {
    nowIso: "2026-04-25T11:10:00.000Z"
  });

  assert.equal(decision.action, "blocked");
  assert.equal(decision.update.deliveryStatus, "blocked");
  assert.equal(decision.update.lastDiagnosticCode, "cloud_production_verify_failed");
});
