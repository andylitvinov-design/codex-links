import test from "node:test";
import assert from "node:assert/strict";

import {
  COMMAND_TIMEOUTS,
  claimNextCommand,
  createCommandRecord,
  getCommandById,
  markCommandAnswered,
  runCommandMaintenance,
  updateCommandProgress,
  writeCommands
} from "../functions/_lib/commands.js";
import {
  COMMAND_ITEM_PREFIX,
  COMMAND_LOCAL_PROCESSING_STORAGE_KEY
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
    fallbackCount: 1
  }]);

  const result = await runCommandMaintenance(env, {
    fallbackToLocal: false,
    preferSlack: false
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

test("claimNextCommand ignores orphaned local processing entries outside retention", async () => {
  const env = createMockEnv();
  const createdAt = new Date().toISOString();
  const staleCreatedAt = new Date(Date.now() - (8 * 24 * 60 * 60 * 1000)).toISOString();

  await writeCommands(env, [{
    id: "cmd-queued-now",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "fix the dialogs",
    createdAt,
    progressUpdatedAt: createdAt,
    dispatchMode: "local-bridge",
    requestedExecutor: "bridge",
    actualExecutor: "",
    status: "queued",
    progressStage: "queued"
  }]);

  await env.LINKS_STORE.put(`${COMMAND_ITEM_PREFIX}cmd-orphan-processing`, JSON.stringify({
    id: "cmd-orphan-processing",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "stale processing entry",
    createdAt: staleCreatedAt,
    progressUpdatedAt: staleCreatedAt,
    dispatchMode: "local-bridge",
    requestedExecutor: "bridge",
    actualExecutor: "bridge",
    status: "processing",
    progressStage: "waiting-for-codex",
    processingLeaseUntil: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  }));
  await env.LINKS_STORE.put(COMMAND_LOCAL_PROCESSING_STORAGE_KEY, JSON.stringify(["cmd-orphan-processing"]));

  const claimed = await claimNextCommand(env, {
    processorId: "test-bridge",
    leaseMs: 30_000
  });

  assert.equal(claimed.ok, true);
  assert.ok(claimed.value);
  assert.equal(claimed.value.id, "cmd-queued-now");
  assert.equal(claimed.value.status, "processing");
});

test("claimNextCommand can claim claude-bridge commands from the dedicated queue", async () => {
  const env = createMockEnv();
  const createdAt = new Date().toISOString();

  await writeCommands(env, [{
    id: "cmd-claude-queued",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "summarize this repo state",
    createdAt,
    progressUpdatedAt: createdAt,
    dispatchMode: "claude-bridge",
    targetExecutionMode: "claude",
    requestedExecutor: "claude",
    actualExecutor: "",
    status: "queued",
    progressStage: "queued"
  }]);

  const claimed = await claimNextCommand(env, {
    processorId: "claude-worker",
    dispatchMode: "claude-bridge",
    leaseMs: 30_000
  });

  assert.equal(claimed.ok, true);
  assert.ok(claimed.value);
  assert.equal(claimed.value.id, "cmd-claude-queued");
  assert.equal(claimed.value.dispatchMode, "claude-bridge");
  assert.equal(claimed.value.actualExecutor, "claude");
  assert.equal(claimed.value.status, "processing");
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
    preferSlack: false
  });

  assert.equal(result.changed, false);
  assert.deepEqual(result.commandsToDispatch, ["cmd-cloud-fallback"]);
});

test("runCommandMaintenance fails stale bridge commands instead of rerouting them to Slack cloud", async () => {
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
    preferSlack: true
  });

  assert.equal(result.changed, true);
  assert.equal(result.changedCount, 1);
  assert.deepEqual(result.commandsToDispatch, []);

  const updated = result.commands.find((command) => command.id === "cmd-bridge-timeout");
  assert.ok(updated);
  assert.equal(updated.dispatchMode, "local-bridge");
  assert.equal(updated.status, "failed");
  assert.equal(updated.progressStage, "failed");
  assert.equal(updated.timeoutPhase, "result-timeout");
  assert.equal(updated.lastDiagnosticCode, "bridge_result_timeout");
  assert.equal(updated.actualExecutor, "bridge");
  assert.match(updated.errorMessage, /bridge_result_timeout/);
});

test("runCommandMaintenance fails stale photo bridge commands instead of rerouting them", async () => {
  const env = createMockEnv();
  const staleIso = new Date(Date.now() - (3 * 60 * 1000)).toISOString();

  await writeCommands(env, [{
    id: "cmd-bridge-photo-timeout",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "Что на фото?",
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
    photoAttached: true,
    photoBytesPresent: true
  }]);

  const result = await runCommandMaintenance(env, {
    fallbackToLocal: true,
    preferSlack: true
  });

  assert.equal(result.changed, true);
  assert.equal(result.changedCount, 1);
  assert.deepEqual(result.commandsToDispatch, []);

  const updated = result.commands.find((command) => command.id === "cmd-bridge-photo-timeout");
  assert.ok(updated);
  assert.equal(updated.dispatchMode, "local-bridge");
  assert.equal(updated.status, "queued");
  assert.equal(updated.progressStage, "retrying-photo-bridge");
  assert.equal(updated.timeoutPhase, "result-timeout");
  assert.equal(updated.lastDiagnosticCode, "bridge_result_timeout");
  assert.match(updated.errorMessage, /retrying_photo_bridge/);
});

test("runCommandMaintenance fails stale queued bridge text commands even when another thread is processing", async () => {
  const env = createMockEnv();
  const staleIso = new Date(Date.now() - (COMMAND_TIMEOUTS.bridgeClaimMs + 20 * 1000)).toISOString();
  const freshIso = new Date().toISOString();

  await writeCommands(env, [
    {
      id: "cmd-processing-other-thread",
      clientId: "test-client",
      threadId: "ezohata",
      threadLabel: "ezohata",
      text: "other thread still running",
      createdAt: freshIso,
      progressUpdatedAt: freshIso,
      dispatchMode: "local-bridge",
      requestedExecutor: "bridge",
      actualExecutor: "bridge",
      status: "processing",
      progressStage: "waiting-for-codex",
      processingStartedAt: freshIso,
      processingLeaseUntil: new Date(Date.now() + 60_000).toISOString()
    },
    {
      id: "cmd-queued-stale-text",
      clientId: "test-client",
      threadId: "links",
      threadLabel: "links",
      text: "fix the dialogs",
      createdAt: staleIso,
      progressUpdatedAt: staleIso,
      dispatchMode: "local-bridge",
      requestedExecutor: "bridge",
      actualExecutor: "",
      status: "queued",
      progressStage: "queued",
      targetRepo: "andylitvinov-design/codex-links"
    }
  ]);

  const result = await runCommandMaintenance(env, {
    fallbackToLocal: true,
    preferSlack: true
  });

  const updated = result.commands.find((command) => command.id === "cmd-queued-stale-text");
  assert.ok(updated);
  assert.equal(updated.dispatchMode, "local-bridge");
  assert.equal(updated.status, "failed");
  assert.equal(updated.progressStage, "failed");
  assert.equal(updated.lastDiagnosticCode, "bridge_claim_timeout");
  assert.match(updated.errorMessage, /bridge_claim_timeout/);
});

test("runCommandMaintenance keeps queued bridge commands waiting when the same thread still has a fresh processing command", async () => {
  const env = createMockEnv();
  const staleIso = new Date(Date.now() - (COMMAND_TIMEOUTS.bridgeClaimMs + 20 * 1000)).toISOString();
  const freshIso = new Date().toISOString();

  await writeCommands(env, [
    {
      id: "cmd-processing-same-thread",
      clientId: "test-client",
      threadId: "links",
      threadLabel: "links",
      text: "same thread still running",
      createdAt: freshIso,
      progressUpdatedAt: freshIso,
      dispatchMode: "local-bridge",
      requestedExecutor: "bridge",
      actualExecutor: "bridge",
      status: "processing",
      progressStage: "waiting-for-codex",
      processingStartedAt: freshIso,
      processingLeaseUntil: new Date(Date.now() + 60_000).toISOString()
    },
    {
      id: "cmd-queued-same-thread",
      clientId: "test-client",
      threadId: "links",
      threadLabel: "links",
      text: "fix the dialogs",
      createdAt: staleIso,
      progressUpdatedAt: staleIso,
      dispatchMode: "local-bridge",
      requestedExecutor: "bridge",
      actualExecutor: "",
      status: "queued",
      progressStage: "queued",
      targetRepo: "andylitvinov-design/codex-links"
    }
  ]);

  const result = await runCommandMaintenance(env, {
    fallbackToLocal: true,
    preferSlack: true
  });

  const updated = result.commands.find((command) => command.id === "cmd-queued-same-thread");
  assert.ok(updated);
  assert.equal(updated.dispatchMode, "local-bridge");
  assert.equal(updated.status, "queued");
  assert.equal(updated.progressStage, "queued");
});

test("runCommandMaintenance refreshes queued bridge freshness while the same thread is still processing", async () => {
  const env = createMockEnv();
  const staleIso = new Date(Date.now() - (40 * 1000)).toISOString();
  const freshIso = new Date().toISOString();

  await writeCommands(env, [
    {
      id: "cmd-processing-same-thread-refresh",
      clientId: "test-client",
      threadId: "links",
      threadLabel: "links",
      text: "same thread still running",
      createdAt: freshIso,
      progressUpdatedAt: freshIso,
      dispatchMode: "local-bridge",
      requestedExecutor: "bridge",
      actualExecutor: "bridge",
      status: "processing",
      progressStage: "waiting-for-codex",
      processingStartedAt: freshIso,
      processingLeaseUntil: new Date(Date.now() + 60_000).toISOString()
    },
    {
      id: "cmd-queued-same-thread-refresh",
      clientId: "test-client",
      threadId: "links",
      threadLabel: "links",
      text: "fix the dialogs",
      createdAt: staleIso,
      progressUpdatedAt: staleIso,
      dispatchMode: "local-bridge",
      requestedExecutor: "bridge",
      actualExecutor: "",
      status: "queued",
      progressStage: "queued",
      targetRepo: "andylitvinov-design/codex-links"
    }
  ]);

  const result = await runCommandMaintenance(env, {
    fallbackToLocal: true,
    preferSlack: true
  });

  const updated = result.commands.find((command) => command.id === "cmd-queued-same-thread-refresh");
  assert.ok(updated);
  assert.equal(updated.dispatchMode, "local-bridge");
  assert.equal(updated.status, "queued");
  assert.equal(updated.progressStage, "queued");
  assert.ok(Date.parse(String(updated.progressUpdatedAt || "").trim()) > Date.parse(staleIso));
});

test("runCommandMaintenance fails stale Slack commands that never got an ack", async () => {
  const env = createMockEnv();
  const staleIso = new Date(Date.now() - (3 * 60 * 1000)).toISOString();

  await writeCommands(env, [{
    id: "cmd-slack-no-ack",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "fix the dialogs",
    createdAt: staleIso,
    progressUpdatedAt: staleIso,
    dispatchMode: "slack-codex-cloud",
    requestedExecutor: "bridge",
    actualExecutor: "",
    status: "dispatched",
    progressStage: "dispatched",
    slackDispatchAttempted: true,
    slackDispatchSucceeded: true,
    slackPostedAt: staleIso,
    dispatchedAt: staleIso,
    fallbackCount: 1,
    fallbackApplied: true,
    fallbackReason: "local bridge did not claim the command in time",
    lastDiagnosticCode: "bridge_claim_timeout"
  }]);

  const result = await runCommandMaintenance(env, {
    fallbackToLocal: false,
    preferSlack: true
  });

  const updated = result.commands.find((command) => command.id === "cmd-slack-no-ack");
  assert.ok(updated);
  assert.equal(updated.status, "failed");
  assert.equal(updated.progressStage, "failed");
  assert.equal(updated.timeoutPhase, "first-ack-timeout");
  assert.equal(updated.lastDiagnosticCode, "slack_first_ack_timeout");
  assert.equal(updated.actualExecutor, "cloud-via-slack");
});

test("runCommandMaintenance retries queued Claude bridge commands before fallback", async () => {
  const env = createMockEnv();
  const staleIso = new Date(Date.now() - 90_000).toISOString();

  await writeCommands(env, [{
    id: "cmd-claude-claim-retry",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "summarize this repo state",
    createdAt: staleIso,
    progressUpdatedAt: staleIso,
    dispatchMode: "claude-bridge",
    requestedExecutor: "claude",
    actualExecutor: "",
    status: "queued",
    progressStage: "queued"
  }]);

  const result = await runCommandMaintenance(env, {
    fallbackToLocal: true
  });

  const updated = result.commands.find((command) => command.id === "cmd-claude-claim-retry");
  assert.ok(updated);
  assert.equal(updated.dispatchMode, "claude-bridge");
  assert.equal(updated.status, "queued");
  assert.equal(updated.progressStage, "retrying-claude-claim");
  assert.equal(updated.lastDiagnosticCode, "claude_claim_timeout");
  assert.equal(updated.actualExecutor, "claude");
});

test("runCommandMaintenance falls back stale Claude queue commands to local bridge after retry window", async () => {
  const env = createMockEnv();
  const staleIso = new Date(Date.now() - (11 * 60 * 1000)).toISOString();

  await writeCommands(env, [{
    id: "cmd-claude-claim-fallback",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "summarize this repo state",
    createdAt: staleIso,
    progressUpdatedAt: staleIso,
    dispatchMode: "claude-bridge",
    requestedExecutor: "claude",
    actualExecutor: "",
    status: "queued",
    progressStage: "queued"
  }]);

  const result = await runCommandMaintenance(env, {
    fallbackToLocal: true
  });

  const updated = result.commands.find((command) => command.id === "cmd-claude-claim-fallback");
  assert.ok(updated);
  assert.equal(updated.dispatchMode, "local-bridge");
  assert.equal(updated.status, "queued");
  assert.equal(updated.progressStage, "fallback-to-bridge");
  assert.equal(updated.lastDiagnosticCode, "claude_claim_timeout");
  assert.equal(updated.actualExecutor, "bridge");
});

test("runCommandMaintenance retries stale Claude processing before fallback", async () => {
  const env = createMockEnv();
  const staleIso = new Date(Date.now() - (4 * 60 * 1000)).toISOString();

  await writeCommands(env, [{
    id: "cmd-claude-result-retry",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "summarize this repo state",
    createdAt: staleIso,
    progressUpdatedAt: staleIso,
    dispatchMode: "claude-bridge",
    requestedExecutor: "claude",
    actualExecutor: "claude",
    status: "processing",
    progressStage: "waiting-for-codex",
    processingStartedAt: staleIso,
    processingLeaseUntil: new Date(Date.now() - 1_000).toISOString(),
    firstAckAt: staleIso
  }]);

  const result = await runCommandMaintenance(env, {
    fallbackToLocal: true
  });

  const updated = result.commands.find((command) => command.id === "cmd-claude-result-retry");
  assert.ok(updated);
  assert.equal(updated.dispatchMode, "claude-bridge");
  assert.equal(updated.status, "queued");
  assert.equal(updated.progressStage, "retrying-claude");
  assert.equal(updated.lastDiagnosticCode, "claude_result_timeout");
  assert.equal(updated.actualExecutor, "claude");
});

test("runCommandMaintenance fails stale Claude commands after retry window when fallback is unavailable", async () => {
  const env = createMockEnv();
  const staleIso = new Date(Date.now() - (11 * 60 * 1000)).toISOString();

  await writeCommands(env, [{
    id: "cmd-claude-fail",
    clientId: "test-client",
    threadId: "cloud:ephemeral",
    threadLabel: "cloud:ephemeral",
    text: "summarize this repo state",
    createdAt: staleIso,
    progressUpdatedAt: staleIso,
    dispatchMode: "claude-bridge",
    requestedExecutor: "claude",
    actualExecutor: "claude",
    status: "processing",
    progressStage: "waiting-for-codex",
    processingStartedAt: staleIso,
    processingLeaseUntil: new Date(Date.now() - 1_000).toISOString(),
    firstAckAt: staleIso,
    fallbackCount: 1
  }]);

  const result = await runCommandMaintenance(env, {
    fallbackToLocal: true
  });

  const updated = result.commands.find((command) => command.id === "cmd-claude-fail");
  assert.ok(updated);
  assert.equal(updated.dispatchMode, "claude-bridge");
  assert.equal(updated.status, "failed");
  assert.equal(updated.progressStage, "failed");
  assert.equal(updated.lastDiagnosticCode, "claude_result_timeout");
});

test("runCommandMaintenance falls back photo Slack upload failures to local bridge when fallback is available", async () => {
  const env = createMockEnv();
  const staleIso = new Date(Date.now() - (2 * 60 * 1000)).toISOString();

  await writeCommands(env, [{
    id: "cmd-slack-photo-upload-error",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "Что на фото?",
    createdAt: staleIso,
    progressUpdatedAt: staleIso,
    dispatchMode: "slack-codex-cloud",
    requestedExecutor: "cloud-via-slack",
    actualExecutor: "",
    status: "dispatched",
    progressStage: "dispatched",
    slackDispatchAttempted: true,
    slackDispatchSucceeded: true,
    slackPostedAt: staleIso,
    dispatchedAt: staleIso,
    photoAttached: true,
    photoBytesPresent: true,
    slackPhotoUploadError: "temporarily_unavailable"
  }]);

  const result = await runCommandMaintenance(env, {
    fallbackToLocal: true,
    preferSlack: true
  });

  const updated = result.commands.find((command) => command.id === "cmd-slack-photo-upload-error");
  assert.ok(updated);
  assert.equal(updated.dispatchMode, "local-bridge");
  assert.equal(updated.status, "queued");
  assert.equal(updated.progressStage, "fallback-to-bridge");
  assert.equal(updated.lastDiagnosticCode, "slack_photo_upload_failed");
  assert.equal(updated.actualExecutor, "bridge");
  assert.equal(updated.fallbackReason, "cloud via Slack photo upload failed");
});

test("runCommandMaintenance reroutes stale actor-validation Slack failures to local bridge", async () => {
  const env = createMockEnv();
  const staleIso = new Date(Date.now() - (2 * 60 * 1000)).toISOString();

  await writeCommands(env, [{
    id: "cmd-slack-actor-validation-stuck",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    fallbackThreadId: "links",
    fallbackThreadLabel: "links",
    text: "fix the dialogs",
    createdAt: staleIso,
    progressUpdatedAt: staleIso,
    dispatchMode: "slack-codex-cloud",
    requestedExecutor: "cloud-via-slack",
    actualExecutor: "",
    status: "processing",
    progressStage: "dispatching",
    lastDiagnosticCode: "codex_target_actor_unverified",
    errorMessage: JSON.stringify({
      code: "codex_target_actor_unverified",
      stage: "codex-target-actor-invalid",
      message: "Configured Slack target user did not acknowledge the live probe.",
      detail: "Slack membership is not enough."
    })
  }]);

  const result = await runCommandMaintenance(env, {
    fallbackToLocal: true
  });

  const updated = result.commands.find((command) => command.id === "cmd-slack-actor-validation-stuck");
  assert.ok(updated);
  assert.equal(updated.dispatchMode, "local-bridge");
  assert.equal(updated.status, "queued");
  assert.equal(updated.progressStage, "fallback-to-bridge");
  assert.equal(updated.lastDiagnosticCode, "codex_target_actor_unverified");
});

test("updateCommandProgress ignores heartbeats for queued photo commands", async () => {
  const env = createMockEnv();
  const createdAt = new Date().toISOString();

  await writeCommands(env, [{
    id: "cmd-photo-queued",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "inspect photo",
    createdAt,
    progressUpdatedAt: createdAt,
    dispatchMode: "local-bridge",
    requestedExecutor: "bridge",
    actualExecutor: "",
    status: "queued",
    progressStage: "queued",
    photoAttached: true,
    photoBytesPresent: true,
    photoSeenByBridge: true,
    photoProcessed: true
  }]);

  const updated = await updateCommandProgress(env, {
    id: "cmd-photo-queued",
    progressStage: "waiting-for-codex",
    processingLeaseUntil: new Date(Date.now() + 60_000).toISOString()
  });

  assert.equal(updated.ok, true);
  assert.equal(updated.value?.status, "queued");
  assert.equal(updated.value?.progressStage, "queued");
  assert.ok(!updated.value?.processingLeaseUntil);
  assert.equal(updated.value?.photoSeenByBridge, true);
  assert.equal(updated.value?.photoProcessed, true);
});

test("markCommandAnswered ignores late bridge completion after processor ownership changed", async () => {
  const env = createMockEnv();
  const createdAt = new Date().toISOString();

  await writeCommands(env, [{
    id: "cmd-owned-processing",
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "fix the dialogs",
    createdAt,
    progressUpdatedAt: createdAt,
    dispatchMode: "slack-codex-cloud",
    requestedExecutor: "bridge",
    actualExecutor: "cloud-via-slack",
    status: "queued",
    progressStage: "switched-to-cloud",
    processorId: "",
    fallbackApplied: true,
    fallbackCount: 1,
    fallbackReason: "local bridge stopped heartbeating"
  }]);

  const result = await markCommandAnswered(env, {
    id: "cmd-owned-processing",
    progressStage: "answered",
    actualExecutor: "bridge",
    expectedProcessorId: "bridge-worker-1"
  });

  assert.equal(result.ok, true);
  assert.equal(result.value?.status, "queued");
  assert.equal(result.value?.progressStage, "switched-to-cloud");
  assert.equal(result.value?.actualExecutor, "cloud-via-slack");

  const stored = await getCommandById(env, "cmd-owned-processing");
  assert.equal(stored?.status, "queued");
  assert.equal(stored?.progressStage, "switched-to-cloud");
});

test("createCommandRecord accepts explicit retrying bridge stages for bridge-unavailable intake", () => {
  const created = createCommandRecord({
    clientId: "test-client",
    threadId: "links",
    threadLabel: "links",
    text: "Посмотри на фото",
    dispatchMode: "local-bridge",
    progressStage: "waiting-photo-bridge",
    lastDiagnosticCode: "bridge_temporarily_unavailable",
    lastDiagnosticDetail: "Bridge is offline right now.",
    photo: {
      contentType: "image/png",
      fileName: "photo.png",
      size: 128,
      dataUrl: "data:image/png;base64,AA=="
    }
  });

  assert.equal(created.ok, true);
  assert.equal(created.value.progressStage, "waiting-photo-bridge");
  assert.equal(created.value.lastDiagnosticCode, "bridge_temporarily_unavailable");
  assert.equal(created.value.lastDiagnosticDetail, "Bridge is offline right now.");
});
