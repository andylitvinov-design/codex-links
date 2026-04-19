import { executeTrustedCloudJob, getFailureAssistantText } from "./shared-codex-executor.mjs";

export const CLOUD_BRIDGE_HEARTBEAT_MS = 15 * 1000;

function noop() {}

function defaultScheduleHeartbeat(callback, intervalMs) {
  const handle = setInterval(() => {
    void callback();
  }, intervalMs);
  return () => clearInterval(handle);
}

export function createCloudBridgeHealthPayload({ busy = false } = {}) {
  return {
    ok: true,
    ready: true,
    busy: Boolean(busy)
  };
}

export function startCloudBridgeHeartbeat({
  commandId,
  cloudJobId,
  updateProgress,
  progressMessage = "Trusted cloud bridge is still running Codex.",
  heartbeatMs = CLOUD_BRIDGE_HEARTBEAT_MS,
  scheduleHeartbeat = defaultScheduleHeartbeat,
  onHeartbeatError = noop
}) {
  if (!commandId || !cloudJobId || typeof updateProgress !== "function") {
    return () => {};
  }

  let stopped = false;
  let pending = false;

  const tick = async () => {
    if (stopped || pending) {
      return;
    }

    pending = true;

    try {
      await updateProgress(commandId, cloudJobId, "running", progressMessage);
    } catch (error) {
      onHeartbeatError(error);
    } finally {
      pending = false;
    }
  };

  const cancel = scheduleHeartbeat(tick, heartbeatMs);

  return async () => {
    stopped = true;
    if (typeof cancel === "function") {
      await cancel();
    }
  };
}

export async function processTrustedCloudJob(job, options = {}) {
  const command = job?.command;
  const executeJob = typeof options.executeTrustedCloudJob === "function"
    ? options.executeTrustedCloudJob
    : executeTrustedCloudJob;
  const updateProgress = typeof options.updateProgress === "function"
    ? options.updateProgress
    : async () => {};
  const markAnswered = typeof options.markAnswered === "function"
    ? options.markAnswered
    : async () => {};
  const markFailed = typeof options.markFailed === "function"
    ? options.markFailed
    : async () => {};
  const publishStatus = typeof options.publishStatus === "function"
    ? options.publishStatus
    : async () => {};
  const getFailureText = typeof options.getFailureAssistantText === "function"
    ? options.getFailureAssistantText
    : getFailureAssistantText;
  const scheduleHeartbeat = typeof options.scheduleHeartbeat === "function"
    ? options.scheduleHeartbeat
    : defaultScheduleHeartbeat;
  const onHeartbeatError = typeof options.onHeartbeatError === "function"
    ? options.onHeartbeatError
    : noop;

  await publishStatus("running", {
    lastDispatchAt: job?.acceptedAt || "",
    lastError: ""
  });
  await updateProgress(command.id, job.jobId, "running", "Trusted cloud bridge is running Codex.");

  let stopHeartbeat = async () => {};

  try {
    stopHeartbeat = startCloudBridgeHeartbeat({
      commandId: command.id,
      cloudJobId: job.jobId,
      updateProgress,
      scheduleHeartbeat,
      onHeartbeatError
    });

    const result = await executeJob(command, {
      onProgress: async (progressStage, progressMessage) => {
        await updateProgress(command.id, job.jobId, progressStage, progressMessage);
      }
    });

    await stopHeartbeat();
    await markAnswered(command, job.jobId, result.assistantText, job.acceptedAt);

    return {
      ok: true,
      assistantText: result.assistantText,
      failureText: ""
    };
  } catch (error) {
    await stopHeartbeat();
    await markFailed(command, job.jobId, job.acceptedAt, error);

    return {
      ok: false,
      assistantText: "",
      failureText: getFailureText(error),
      error
    };
  }
}
