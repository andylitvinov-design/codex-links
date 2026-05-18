import { insertCommand } from "../../_lib/commands.js";
import { handleOptions, json } from "../../_lib/http.js";
import {
  buildClaudeVerificationPrompt,
  buildCodeCopilotReviewPrompt,
  buildRewrittenPrompt,
  normalizePromptRouterPayload
} from "../../_lib/prompt-router.js";
import { getSafePromptMetadata } from "../../_lib/prompt-router-security.js";

const TARGETS = new Set(["codex", "claude-code", "code-copilot", "github-issue", "copy"]);

function normalizeTarget(value) {
  const target = String(value || "copy").trim().toLowerCase();
  return TARGETS.has(target) ? target : "copy";
}

function getPollUrl(commandId) {
  const normalized = String(commandId || "").trim();
  return normalized ? `/api/commands?id=${encodeURIComponent(normalized)}` : "";
}

function isCodeCopilotBridgeEnabled(env) {
  return String(env?.CODE_COPILOT_BRIDGE_ENABLED || "").trim().toLowerCase() === "true";
}

function buildDeployMetadata(normalized) {
  if (!normalized.liveUrl) return null;

  return {
    platform: normalized.liveUrl.includes("vercel.app") ? "vercel" : "web",
    productionBranch: "main",
    productionUrl: normalized.liveUrl,
    smokePath: normalized.liveUrl.includes("ezohata-incoming-ledger") ? "/api/status" : "/"
  };
}

function buildCommandPayload(payload, prompt, target) {
  const normalized = normalizePromptRouterPayload(payload);
  const clientId = `prompt-router-${target}`;
  const threadId = normalized.project || "links";
  const requestedExecutor = target === "claude-code"
    ? "claude"
    : target === "code-copilot"
      ? "code-copilot"
      : "cloud-via-slack";
  const dispatchMode = target === "code-copilot" ? "code-copilot-bridge" : requestedExecutor;
  const deploy = buildDeployMetadata(normalized);

  return {
    clientId,
    threadId,
    projectId: threadId,
    projectLabel: normalized.project || threadId,
    projectCategory: normalized.category,
    targetRepo: normalized.repo,
    targetRepoUrl: normalized.repo ? `https://github.com/${normalized.repo}` : "",
    targetContextFiles: ["AGENTS.md", "README.md", "STATE.md"],
    deploy,
    targetExecutionMode: requestedExecutor,
    requestedExecutor,
    dispatchMode,
    text: prompt,
    effectivePrompt: prompt,
    source: "prompt-router",
    promptRouter: {
      target,
      category: normalized.category,
      liveUrl: normalized.liveUrl,
      problemPresent: Boolean(normalized.problem)
    }
  };
}

async function dispatchViaCommands(context, payload, prompt, target) {
  const url = new URL(context.request.url);
  const commandsUrl = `${url.origin}/api/commands`;
  const token = context.request.headers.get("x-write-token") || context.request.headers.get("authorization") || "";
  const headers = { "content-type": "application/json" };

  if (token) {
    if (/^Bearer\s+/i.test(token)) headers.authorization = token;
    else headers["x-write-token"] = token;
  }

  const response = await fetch(commandsUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(buildCommandPayload(payload, prompt, target))
  });
  const bodyText = await response.text();
  let body = null;

  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    body = null;
  }

  if (!response.ok || !body?.ok) {
    return {
      ok: false,
      status: response.status,
      error: body?.error || "commands_dispatch_unavailable",
      excerpt: bodyText.slice(0, 300)
    };
  }

  return { ok: true, command: body.command || null };
}

async function createCodeCopilotCommand(context, payload, prompt) {
  if (!isCodeCopilotBridgeEnabled(context.env)) {
    return { ok: false, bridgeDisabled: true };
  }

  const created = await insertCommand(context.env, buildCommandPayload(payload, prompt, "code-copilot"));
  if (!created.ok) {
    return { ok: false, error: created.error || "code_copilot_command_create_failed" };
  }

  return { ok: true, command: created.value };
}

function buildIssuePrompt(payload, prompt) {
  const normalized = normalizePromptRouterPayload(payload);
  return `Title: Prompt Router task - ${normalized.category}\n\nRepo: ${normalized.repo}\nLive URL: ${normalized.liveUrl}\n\n${prompt}`;
}

function promptOnlyResponse({ target, prompt, status, dispatch }) {
  return json({
    ok: true,
    mode: "prompt-only",
    target,
    prompt,
    status,
    ...(dispatch ? { dispatch } : {})
  });
}

function commandDispatchResponse({ target, mode, command, prompt }) {
  const commandId = command?.id || "";
  return json({
    ok: true,
    mode,
    target,
    commandId,
    pollUrl: getPollUrl(commandId),
    prompt,
    status: command?.status || "queued",
    dispatch: {
      attempted: true,
      status: "created"
    }
  });
}

export async function onRequest(context) {
  const { request } = context;
  const preflight = handleOptions(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "validation_error", message: "Request body must be valid JSON." }, { status: 400 });
  }

  const normalized = normalizePromptRouterPayload(payload);
  const target = normalizeTarget(payload?.target);
  const basePrompt = normalized.prompt || buildRewrittenPrompt(normalized);

  if (!basePrompt) {
    return json({ ok: false, error: "validation_error", message: "prompt is required" }, { status: 400 });
  }

  let finalPrompt = basePrompt;
  if (target === "claude-code") {
    finalPrompt = buildClaudeVerificationPrompt({ ...normalized, prompt: basePrompt });
  } else if (target === "code-copilot") {
    finalPrompt = buildCodeCopilotReviewPrompt({ ...normalized, prompt: basePrompt });
  } else if (target === "github-issue") {
    finalPrompt = buildIssuePrompt(normalized, basePrompt);
  }

  console.log("[prompt-router] send", getSafePromptMetadata({ ...payload, target }));

  if (target === "copy") {
    return promptOnlyResponse({ target, prompt: finalPrompt, status: "copyable_prompt" });
  }

  if (target === "code-copilot") {
    try {
      const created = await createCodeCopilotCommand(context, normalized, finalPrompt);
      if (created.ok) {
        return commandDispatchResponse({
          target,
          mode: "code-copilot-dispatch",
          command: created.command,
          prompt: finalPrompt
        });
      }

      return promptOnlyResponse({
        target,
        prompt: finalPrompt,
        status: created.bridgeDisabled ? "code_copilot_bridge_not_configured" : (created.error || "code_copilot_dispatch_unavailable")
      });
    } catch (error) {
      return promptOnlyResponse({
        target,
        prompt: finalPrompt,
        status: "code_copilot_dispatch_exception_fallback",
        dispatch: {
          attempted: true,
          status: "exception",
          excerpt: String(error?.message || error || "Code Copilot dispatch failed.").slice(0, 300)
        }
      });
    }
  }

  if (target === "github-issue") {
    return promptOnlyResponse({ target, prompt: finalPrompt, status: "github_issue_adapter_not_configured" });
  }

  try {
    const dispatched = await dispatchViaCommands(context, normalized, finalPrompt, target);
    if (!dispatched.ok) {
      return promptOnlyResponse({
        target,
        prompt: finalPrompt,
        status: dispatched.error || "dispatch_unavailable",
        dispatch: {
          attempted: true,
          status: dispatched.status,
          excerpt: dispatched.excerpt
        }
      });
    }

    return commandDispatchResponse({
      target,
      mode: target === "claude-code" ? "claude-dispatch" : "codex-dispatch",
      command: dispatched.command,
      prompt: finalPrompt
    });
  } catch (error) {
    return promptOnlyResponse({
      target,
      prompt: finalPrompt,
      status: "dispatch_exception_fallback",
      dispatch: {
        attempted: true,
        status: "exception",
        excerpt: String(error?.message || error || "Dispatch failed.").slice(0, 300)
      }
    });
  }
}