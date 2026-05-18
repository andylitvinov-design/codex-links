const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const TERMINAL_STATUSES = new Set(["answered", "failed", "acked"]);

let pollTimer = null;
let pollStartedAt = 0;

const executionResult = document.getElementById("executionResult");
const stopPollingButton = document.getElementById("stopPolling");

function renderExecutionResult(data = {}, note = "") {
  if (!executionResult) return;

  const command = data.command || data;
  const lines = [];
  const add = (label, value) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      lines.push(`${label}: ${value}`);
    }
  };

  if (note) lines.push(note, "");

  add("commandId", command.id || command.commandId);
  add("status", command.status);
  add("actualExecutor", command.actualExecutor || command.actualDispatchMode);
  add("requestedExecutor", command.requestedExecutor || command.targetExecutionMode);
  add("fallbackReason", command.fallbackReason);
  add("deliveryStatus", command.deliveryStatus);
  add("resultAt", command.resultAt || command.completedAt);
  add("PR URL", command.prUrl);
  add("production URL", command.productionUrl);
  add("error", command.errorMessage || command.error || data.error);

  const reply = command.replyText || command.answerText || command.assistantReply || command.deliveryFeedback || command.resultText;
  if (reply) {
    lines.push("", "Reply:", String(reply));
  } else if (command.id || command.commandId) {
    lines.push("", "Reply text is not present in this command response. Check the existing timeline/thread UI for the full reply if needed.");
  }

  executionResult.textContent = lines.length ? lines.join("\n") : "No command result yet.";
}

function stopCommandPolling(reason = "Polling stopped.") {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  if (reason) renderExecutionResult({}, reason);
}

async function pollCommand(commandId, pollUrl) {
  const url = pollUrl || `/api/commands?id=${encodeURIComponent(commandId)}`;
  const response = await fetch(url, { method: "GET" });
  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: "non_json_response", excerpt: text.slice(0, 300) };
  }

  const command = data.command || data;
  renderExecutionResult(data);

  const status = String(command.status || "").trim().toLowerCase();
  if (TERMINAL_STATUSES.has(status)) {
    stopCommandPolling(`Command ${commandId} finished with status: ${status}`);
    renderExecutionResult(data, `Command ${commandId} finished with status: ${status}`);
    return;
  }

  if (Date.now() - pollStartedAt > POLL_TIMEOUT_MS) {
    stopCommandPolling(`Polling timed out for command ${commandId}.`);
    return;
  }

  pollTimer = setTimeout(() => {
    pollCommand(commandId, url).catch((error) => {
      stopCommandPolling(`Polling stopped after error: ${String(error?.message || error)}`);
    });
  }, POLL_INTERVAL_MS);
}

function startCommandPolling(commandId, pollUrl) {
  const normalizedId = String(commandId || "").trim();
  if (!normalizedId) return;

  if (pollTimer) clearTimeout(pollTimer);
  pollStartedAt = Date.now();
  renderExecutionResult({ commandId: normalizedId, status: "polling", pollUrl }, "Polling command result...");
  pollCommand(normalizedId, pollUrl).catch((error) => {
    stopCommandPolling(`Polling stopped after error: ${String(error?.message || error)}`);
  });
}

window.addEventListener("prompt-router-send-result", (event) => {
  const result = event.detail || {};

  if (result.target === "code-copilot" && result.status === "code_copilot_bridge_not_configured") {
    renderExecutionResult(result, "Code Copilot bridge is not configured. Prompt prepared for manual independent review.");
    return;
  }

  if (result.commandId) {
    startCommandPolling(result.commandId, result.pollUrl);
    return;
  }

  if (result.mode === "prompt-only") {
    renderExecutionResult(result, "Prompt-only fallback returned.");
  }
});

const originalFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const response = await originalFetch(...args);
  const url = String(args[0]?.url || args[0] || "");
  const method = String(args[1]?.method || "GET").toUpperCase();

  if (method === "POST" && url.includes("/api/prompt-router/send")) {
    response.clone().json().then((body) => {
      window.dispatchEvent(new CustomEvent("prompt-router-send-result", { detail: body }));
    }).catch(() => {});
  }

  return response;
};

stopPollingButton?.addEventListener("click", () => stopCommandPolling("Polling stopped by user."));
renderExecutionResult();
