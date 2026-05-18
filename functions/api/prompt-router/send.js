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

function buildDeployMetadata(normalized) {
  if (!normalized.liveUrl) {
    return null;
  }

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
  const requestedExecutor = target === "claude-code" ? "claude" : "cloud-via-slack";
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
    dispatchMode: requestedExecutor,
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
    if (/^Bearer\s+/i.test(token)) {
      headers.authorization = token;
    } else {
      headers["x-write-token"] = token;
    }
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

  return {
    ok: true,
    command: body.command || null
  };
}

function buildIssuePrompt(payload, prompt) {
  const normalized = normalizePromptRouterPayload(payload);
  return `Title: Prompt Router task - ${normalized.category}\n\nRepo: ${normalized.repo}\nLive URL: ${normalized.liveUrl}\n\n${prompt}`;
}

export async function onRequest(context) {
  const { request } = context;
  const preflight = handleOptions(request);

  if (preflight) {
    return preflight;
  }

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

  if (target === "copy" || target === "code-copilot" || target === "github-issue") {
    return json({
      ok: true,
      mode: "prompt-only",
      target,
      prompt: finalPrompt,
      status: target === "github-issue" ? "github_issue_adapter_not_configured" : "copyable_prompt"
    });
  }

  try {
    const dispatched = await dispatchViaCommands(context, normalized, finalPrompt, target);

    if (!dispatched.ok) {
      return json({
        ok: true,
        mode: "prompt-only",
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

    return json({
      ok: true,
      mode: target === "claude-code" ? "claude-dispatch" : "codex-dispatch",
      target,
      commandId: dispatched.command?.id || "",
      prompt: finalPrompt,
      status: dispatched.command?.status || "queued",
      dispatch: {
        attempted: true,
        status: "created"
      }
    });
  } catch (error) {
    return json({
      ok: true,
      mode: "prompt-only",
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
