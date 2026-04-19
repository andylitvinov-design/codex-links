import test from "node:test";
import assert from "node:assert/strict";

import {
  CLOUD_BRIDGE_HEARTBEAT_MS,
  createCloudBridgeHealthPayload,
  processTrustedCloudJob
} from "../scripts/cloud-bridge-runner.mjs";

test("processTrustedCloudJob heartbeats long-running jobs until completion", async () => {
  const progressCalls = [];
  let resolveJob;
  let scheduledTick = null;
  let cancelled = false;

  const jobPromise = processTrustedCloudJob({
    jobId: "job-1",
    acceptedAt: "2026-04-19T12:00:00.000Z",
    command: {
      id: "cmd-1"
    }
  }, {
    executeTrustedCloudJob: async () => new Promise((resolve) => {
      resolveJob = () => resolve({ assistantText: "done" });
    }),
    updateProgress: async (commandId, cloudJobId, progressStage, progressMessage) => {
      progressCalls.push({ commandId, cloudJobId, progressStage, progressMessage });
    },
    markAnswered: async () => {},
    markFailed: async () => {},
    publishStatus: async () => {},
    scheduleHeartbeat: (tick, intervalMs) => {
      assert.equal(intervalMs, CLOUD_BRIDGE_HEARTBEAT_MS);
      scheduledTick = tick;
      return () => {
        cancelled = true;
      };
    }
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(progressCalls.length, 1);
  assert.equal(progressCalls[0].progressStage, "running");
  assert.equal(progressCalls[0].progressMessage, "Trusted cloud bridge is running Codex.");
  assert.equal(typeof scheduledTick, "function");

  await scheduledTick();
  await scheduledTick();

  assert.equal(progressCalls.length, 3);
  assert.deepEqual(
    progressCalls.slice(1).map((entry) => entry.progressMessage),
    [
      "Trusted cloud bridge is still running Codex.",
      "Trusted cloud bridge is still running Codex."
    ]
  );

  resolveJob();
  const result = await jobPromise;

  assert.equal(result.ok, true);
  assert.equal(cancelled, true);
});

test("processTrustedCloudJob stops heartbeats after failure", async () => {
  const progressCalls = [];
  let scheduledTick = null;
  let cancelled = false;
  let markedFailed = 0;

  const result = await processTrustedCloudJob({
    jobId: "job-2",
    acceptedAt: "2026-04-19T12:00:00.000Z",
    command: {
      id: "cmd-2"
    }
  }, {
    executeTrustedCloudJob: async () => {
      throw new Error("boom");
    },
    updateProgress: async (commandId, cloudJobId, progressStage, progressMessage) => {
      progressCalls.push({ commandId, cloudJobId, progressStage, progressMessage });
    },
    markAnswered: async () => {},
    markFailed: async () => {
      markedFailed += 1;
    },
    publishStatus: async () => {},
    scheduleHeartbeat: (tick) => {
      scheduledTick = tick;
      return () => {
        cancelled = true;
      };
    }
  });

  assert.equal(result.ok, false);
  assert.equal(markedFailed, 1);
  assert.equal(cancelled, true);
  assert.equal(typeof scheduledTick, "function");
  assert.equal(progressCalls.length, 1);
});

test("cloud bridge health payload is redacted by default", () => {
  const payload = createCloudBridgeHealthPayload({ busy: true });

  assert.deepEqual(payload, {
    ok: true,
    ready: true,
    busy: true
  });
  assert.equal("lastJobId" in payload, false);
  assert.equal("lastAcceptedAt" in payload, false);
  assert.equal("lastCompletedAt" in payload, false);
  assert.equal("lastError" in payload, false);
});
