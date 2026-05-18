import assert from "node:assert/strict";
import test from "node:test";

import {
  DISPATCH_MODE_CODE_COPILOT,
  EXECUTOR_ROUTE_CODE_COPILOT,
  dispatchModeToExecutorRoute,
  executorRouteToDispatchMode,
  getDispatchModeLabel,
  getExecutorRouteLabel,
  normalizeDispatchMode,
  normalizeExecutorRoute
} from "../functions/_lib/dispatch.js";
import {
  buildReviewerPrompt,
  parseLmStudioResponse,
  parseOllamaResponse,
  processCommand,
  readConfig
} from "../scripts/code-copilot-bridge.mjs";

test("dispatch helpers normalize Code Copilot bridge route", () => {
  assert.equal(DISPATCH_MODE_CODE_COPILOT, "code-copilot-bridge");
  assert.equal(EXECUTOR_ROUTE_CODE_COPILOT, "code-copilot");
  assert.equal(normalizeDispatchMode("code-copilot"), DISPATCH_MODE_CODE_COPILOT);
  assert.equal(normalizeDispatchMode("code-copilot-bridge"), DISPATCH_MODE_CODE_COPILOT);
  assert.equal(normalizeExecutorRoute("code-copilot"), EXECUTOR_ROUTE_CODE_COPILOT);
  assert.equal(executorRouteToDispatchMode("code-copilot"), DISPATCH_MODE_CODE_COPILOT);
  assert.equal(dispatchModeToExecutorRoute("code-copilot-bridge"), EXECUTOR_ROUTE_CODE_COPILOT);
  assert.equal(getDispatchModeLabel("code-copilot-bridge"), "Code Copilot bridge");
  assert.equal(getExecutorRouteLabel("code-copilot"), "Code Copilot bridge");
});

test("local bridge config defaults to Ollama without OpenAI API", () => {
  const config = readConfig({ LINKS_WRITE_TOKEN: "test-token" });
  assert.equal(config.provider, "ollama");
  assert.equal(config.model, "qwen2.5-coder:7b");
  assert.equal(config.ollamaUrl, "http://127.0.0.1:11434/api/generate");
  assert.equal(config.writeToken, "test-token");
});

test("parses Ollama and LM Studio responses", () => {
  assert.equal(parseOllamaResponse({ response: "ok" }), "ok");
  assert.equal(parseOllamaResponse({ message: { content: "also ok" } }), "also ok");
  assert.equal(parseLmStudioResponse({ choices: [{ message: { content: "lm ok" } }] }), "lm ok");
  assert.equal(parseLmStudioResponse({ choices: [{ text: "text ok" }] }), "text ok");
});

test("buildReviewerPrompt enforces Prompt Router review contract", () => {
  const prompt = buildReviewerPrompt({ text: "Repo: andylitvinov-design/finance" });
  assert.match(prompt, /You are Code Copilot Reviewer/);
  assert.match(prompt, /Do not patch code/);
  assert.match(prompt, /Prompt score: 0-10/);
  assert.match(prompt, /UI → API route → provider\/import → normalization → ledger save → balance → analytics/);
});

test("processCommand posts progress and answer on local model success", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes("/api/commands")) {
      const body = JSON.parse(String(options.body || "{}"));
      calls.push(body);
      return new Response(JSON.stringify({ ok: true, command: { id: body.id || "cmd1" } }), { status: 200 });
    }

    return new Response(JSON.stringify({ response: "Verdict: pass" }), { status: 200 });
  };

  try {
    const config = readConfig({
      LINKS_WRITE_TOKEN: "token",
      CODE_COPILOT_MODEL: "local-test",
      CODE_COPILOT_LOCAL_PROVIDER: "ollama"
    });
    const answer = await processCommand(config, { id: "cmd1", text: "review this" }, "processor1");

    assert.equal(answer, "Verdict: pass");
    assert.equal(calls[0].action, "progress");
    assert.equal(calls[0].progressStage, "code-copilot-reviewing");
    assert.equal(calls[1].action, "answer");
    assert.equal(calls[1].actualExecutor, "code-copilot-bridge");
    assert.equal(calls[1].deliveryFeedback, "Verdict: pass");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
