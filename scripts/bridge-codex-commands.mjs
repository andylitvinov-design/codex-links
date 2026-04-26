  return {
    bridgeOnline: BRIDGE_EXECUTOR !== "claude",
    ...(BRIDGE_EXECUTOR === "claude"
      ? {
          claudeBridge: {
            online: true,
            managedBy: "launchd",
            state: runnerState,
            lastRunAt: now,
            pendingCount: inFlightTasks.size,
            lastError: ""
          }
        }
      : {
          localBridge: {
            online: true,
            managedBy: "launchd",
            state: runnerState,
            lastRunAt: now,
            pendingCount: inFlightTasks.size,
            lastError: ""
          }
        })
  };