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

test("runCommandMaintenance marks stale cloud commands as failed", async () => {
  const env = createMockEnv();
  const staleIso = new Date(Date.now() - (4 * 60 * 1000)).toISOString();

  await writeCommands(env, [{
    id: "cmd-cloud-timeout",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "delivery-probe",
    createdAt: staleIso,
    progressUpdatedAt: staleIso,
    dispatchedAt: staleIso,
    dispatchMode: "cloud",
    requestedExecutor: "cloud",
    actualExecutor: "cloud",
    status: "processing",
    progressStage: "processing",
    fallbackCount: 1,
    cloudJobId: "job-cloud-timeout",
    firstAckAt: staleIso
  }]);

  const result = await runCommandMaintenance(env, {
    fallbackToLocal: false,
    preferCloud: false
  });

  assert.equal(result.changed, true);
  assert.equal(result.changedCount, 1);

  const updated = result.commands.find((command) => command.id === "cmd-cloud-timeout");
  assert.ok(updated);
  assert.equal(updated.dispatchMode, "cloud");
  assert.equal(updated.status, "failed");
  assert.equal(updated.progressStage, "failed");
  assert.equal(updated.timeoutPhase, "result-timeout");
  assert.equal(updated.lastDiagnosticCode, "cloud_result_timeout");
  assert.match(updated.errorMessage, /cloud_result_timeout/);
  assert.ok(updated.completedAt);
});

test("runCommandMaintenance preserves compat mode markers on stale cloud photo failures", async () => {
  const env = createMockEnv();
  const staleIso = new Date(Date.now() - (4 * 60 * 1000)).toISOString();

  await writeCommands(env, [{
    id: "cmd-cloud-photo-compat-timeout",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "inspect the photo",
    createdAt: staleIso,
    progressUpdatedAt: staleIso,
    dispatchedAt: staleIso,
    dispatchMode: "cloud",
    requestedExecutor: "cloud",
    actualExecutor: "cloud",
    status: "processing",
    progressStage: "processing",
    fallbackCount: 1,
    cloudJobId: "job-cloud-photo-timeout",
    firstAckAt: staleIso,
    mode: "compat",
    cloudInputUnverified: true,
    photoAttached: true
  }]);

  const result = await runCommandMaintenance(env, {
    fallbackToLocal: false,
    preferCloud: false
  });

  const updated = result.commands.find((command) => command.id === "cmd-cloud-photo-compat-timeout");
  assert.ok(updated);
  assert.equal(updated.mode, "compat");
  assert.equal(updated.cloudInputUnverified, true);
});

test("runCommandMaintenance schedules queued cloud fallback commands for dispatch", async () => {
  const env = createMockEnv();
  const createdAt = new Date().toISOString();

  await writeCommands(env, [{
    id: "cmd-cloud-fallback",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "fix the dialogs",
    createdAt,
    progressUpdatedAt: createdAt,
    dispatchMode: "cloud",
    requestedExecutor: "bridge",
    actualExecutor: "bridge",
    status: "queued",
    progressStage: "switched-to-cloud",
    fallbackCount: 1,
    fallbackApplied: true,
    fallbackReason: "local bridge stopped heartbeating",
    targetRepo: "andylitvinov-design/codex-links"
  }]);

  const result = await runCommandMaintenance(env, {
    fallbackToLocal: true,
    preferCloud: false
  });

  assert.equal(result.changed, false);
  assert.deepEqual(result.commandsToDispatch, ["cmd-cloud-fallback"]);
});

test("runCommandMaintenance reroutes stale bridge commands to trusted cloud", async () => {
  const env = createMockEnv();
  const staleIso = new Date(Date.now() - (3 * 60 * 1000)).toISOString();

  await writeCommands(env, [{
    id: "cmd-bridge-timeout",
    clientId: "test-client",
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
    targetRepo: "andylitvinov-design/codex-links"
  }]);

  const result = await runCommandMaintenance(env, {
    fallbackToLocal: true,
    preferCloud: true
  });

  assert.equal(result.changed, true);
  assert.equal(result.changedCount, 1);
  assert.deepEqual(result.commandsToDispatch, ["cmd-bridge-timeout"]);

  const updated = result.commands.find((command) => command.id === "cmd-bridge-timeout");
  assert.ok(updated);
  assert.equal(updated.dispatchMode, "cloud");
  assert.equal(updated.status, "queued");
  assert.equal(updated.progressStage, "switched-to-cloud");
  assert.equal(updated.timeoutPhase, "result-timeout");
  assert.equal(updated.lastDiagnosticCode, "bridge_result_timeout");
  assert.match(updated.errorMessage, /fallback_to_cloud/);
});

test("runCommandMaintenance keeps fresh cloud commands active", async () => {
  const env = createMockEnv();
  const freshIso = new Date().toISOString();

  await writeCommands(env, [{
    id: "cmd-cloud-fresh",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "long running cloud task",
    createdAt: freshIso,
    progressUpdatedAt: freshIso,
    dispatchedAt: freshIso,
    dispatchMode: "cloud",
    requestedExecutor: "cloud",
    actualExecutor: "cloud",
    status: "processing",
    progressStage: "running",
    fallbackCount: 1
  }]);

  const result = await runCommandMaintenance(env, {
    fallbackToLocal: false,
    preferCloud: false
  });

  assert.equal(result.changed, false);
  assert.equal(result.changedCount, 0);

  const updated = result.commands.find((command) => command.id === "cmd-cloud-fresh");
  assert.ok(updated);
  assert.equal(updated.dispatchMode, "cloud");
  assert.equal(updated.status, "processing");
  assert.equal(updated.progressStage, "running");
});

test("runCommandMaintenance fails unacked cloud commands instead of treating them as in-flight", async () => {
  const env = createMockEnv();
  const staleIso = new Date(Date.now() - 10_000).toISOString();

  await writeCommands(env, [{
    id: "cmd-cloud-unacked",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "cloud dispatch stuck before ack",
    createdAt: staleIso,
    progressUpdatedAt: staleIso,
    dispatchedAt: staleIso,
    dispatchMode: "cloud",
    requestedExecutor: "cloud",
    actualExecutor: "cloud",
    status: "dispatched",
    progressStage: "waiting",
    fallbackCount: 0,
    cloudJobId: "",
    firstAckAt: ""
  }]);

  const result = await runCommandMaintenance(env, {
    fallbackToLocal: false,
    preferCloud: false
  });

  assert.equal(result.changed, true);
  const updated = result.commands.find((command) => command.id === "cmd-cloud-unacked");
  assert.ok(updated);
  assert.equal(updated.status, "failed");
  assert.equal(updated.timeoutPhase, "claim-timeout");
  assert.equal(updated.lastDiagnosticCode, "cloud_bridge_dispatch_unacked");
});
