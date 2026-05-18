import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EZOHATA_LAYER_CHAIN,
  FAILING_LAYER_PHRASE,
  buildClaudeVerificationPrompt,
  buildCodeCopilotReviewPrompt,
  verifyPromptRouterPrompt
} from "../functions/_lib/prompt-router.js";
import { redactSecrets } from "../functions/_lib/prompt-router-security.js";
import { onRequest as verifyEndpoint } from "../functions/api/prompt-router/verify.js";
import { onRequest as sendEndpoint } from "../functions/api/prompt-router/send.js";

const financePayload = {
  project: "finance",
  repo: "andylitvinov-design/finance",
  liveUrl: "https://ezohata-incoming-ledger.vercel.app",
  category: "Finance balance issue",
  problem: "Факт в аналитике показывает нули, хотя остатки добавлены"
};

const strongPrompt = `Repo: andylitvinov-design/finance
Live URL: https://ezohata-incoming-ledger.vercel.app

User report:
Факт в аналитике показывает нули.

${FAILING_LAYER_PHRASE}

Check chain:
${EZOHATA_LAYER_CHAIN}

Check current deploy/source of truth with /api/status and commitSha.
Check latest PR/commit touching the analytics layer.
For affected endpoints, capture method, status, content-type, first 300 chars body excerpt, and parsing code.
Make a minimal safe patch.
Do not change secrets/env.
Do not rewrite architecture.
Add regression tests.
Run node --test tests/*.test.*.
Run bash scripts/release-guard.sh.
Run npm run build, if available.
Do live verification with before/after evidence.
Preserve amount_net balance invariant.
Do not exclude valid amount_net rows only because source=unknown.
Keep provider transport separate from balance logic.
Preserve gross/net/fee/source semantics.
Provider non-JSON errors must become structured JSON, not raw SyntaxError/HTML/plain text.

Output:
1. root cause
2. changed files
3. checks
4. risks
5. before/after evidence`;

function jsonRequest(url, body) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function readJson(response) {
  return JSON.parse(await response.text());
}

test("prompt router page renders required buttons, prefill logic, and lamps", async () => {
  const html = await readFile("public/prompt-router/index.html", "utf8");
  const js = await readFile("public/prompt-router/prompt-router.js", "utf8");

  assert.match(html, /Verify Prompt/);
  assert.match(html, /Send to Codex/);
  assert.match(html, /Send to Claude Code/);
  assert.match(html, /Copy Prompt/);
  assert.match(html, /Quality lamps/);
  assert.match(html, /id="lampList"/);
  assert.match(js, /URLSearchParams/);
  assert.match(js, /renderLamps/);
  for (const key of ["project", "repo", "liveUrl", "category", "problem", "prompt"]) {
    assert.match(js, new RegExp(key));
  }
});

test("weak prompt gets lower score than strong Ezohata prompt", () => {
  const weak = verifyPromptRouterPrompt({ ...financePayload, prompt: "fix it" });
  const strong = verifyPromptRouterPrompt({ ...financePayload, prompt: strongPrompt });

  assert.equal(weak.ok, true);
  assert.equal(strong.ok, true);
  assert.ok(weak.score < strong.score, `${weak.score} should be lower than ${strong.score}`);
  assert.ok(strong.score >= 8);
});

test("lamp statuses show green/yellow/red/gray quality indicators", () => {
  const finance = verifyPromptRouterPrompt({ ...financePayload, prompt: "fix analytics provider API live" });
  const general = verifyPromptRouterPrompt({
    project: "custom",
    repo: "andylitvinov-design/example",
    liveUrl: "",
    category: "Bug fix",
    problem: "button is broken",
    prompt: `Repo: andylitvinov-design/example\n\nUser report:\nbutton is broken\n\n${FAILING_LAYER_PHRASE}`
  });
  const strong = verifyPromptRouterPrompt({ ...financePayload, prompt: strongPrompt });

  assert.equal(finance.ok, true);
  assert.ok(finance.lampStatuses.some((lamp) => lamp.color === "red"));
  assert.ok(finance.lampStatuses.some((lamp) => lamp.color === "yellow"));
  assert.ok(finance.lampStatuses.some((lamp) => lamp.id === "finance-chain"));
  assert.equal(general.ok, true);
  assert.ok(general.lampStatuses.some((lamp) => lamp.color === "gray"));
  assert.ok(strong.lampStatuses.some((lamp) => lamp.color === "green"));
});

test("rewritten prompt includes mandatory failing-layer phrase and Ezohata chain", () => {
  const result = verifyPromptRouterPrompt({ ...financePayload, prompt: "fix analytics" });

  assert.equal(result.ok, true);
  assert.match(result.rewrittenPrompt, new RegExp(FAILING_LAYER_PHRASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(result.rewrittenPrompt, new RegExp(EZOHATA_LAYER_CHAIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("redacts common secrets", () => {
  const redacted = redactSecrets(`Authorization: Bearer sk-testsecret1234567890
OPENAI_API_KEY=sk-anothersecret1234567890
SLACK_BOT_TOKEN=xoxb-123-456-secret
COOKIE=session=private
-----BEGIN PRIVATE KEY-----
abc123
-----END PRIVATE KEY-----`);

  assert.doesNotMatch(redacted, /sk-testsecret/);
  assert.doesNotMatch(redacted, /sk-anothersecret/);
  assert.doesNotMatch(redacted, /xoxb-123/);
  assert.doesNotMatch(redacted, /session=private/);
  assert.match(redacted, /REDACTED_SECRET/);
});

test("verify endpoint returns score, lampStatuses, and rewrittenPrompt", async () => {
  const response = await verifyEndpoint({
    request: jsonRequest("https://codex-links.pages.dev/api/prompt-router/verify", {
      ...financePayload,
      prompt: "fix fact zeros"
    })
  });
  const body = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(typeof body.score, "number");
  assert.ok(Array.isArray(body.lampStatuses));
  assert.match(body.rewrittenPrompt, /First prove the failing layer before patching\./);
});

test("verify endpoint rejects empty prompt", async () => {
  const response = await verifyEndpoint({
    request: jsonRequest("https://codex-links.pages.dev/api/prompt-router/verify", {
      ...financePayload,
      prompt: ""
    })
  });
  const body = await readJson(response);

  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.equal(body.error, "validation_error");
});

test("send target copy returns prompt-only without OpenAI key", async () => {
  const response = await sendEndpoint({
    request: jsonRequest("https://codex-links.pages.dev/api/prompt-router/send", {
      ...financePayload,
      target: "copy",
      prompt: strongPrompt
    })
  });
  const body = await readJson(response);

  assert.equal(body.ok, true);
  assert.equal(body.mode, "prompt-only");
  assert.equal(body.target, "copy");
  assert.match(body.prompt, /Repo: andylitvinov-design\/finance/);
});

test("send target claude-code returns copyable Claude wrapper if dispatch unavailable", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: "offline" }), { status: 503 });

  try {
    const response = await sendEndpoint({
      request: jsonRequest("https://codex-links.pages.dev/api/prompt-router/send", {
        ...financePayload,
        target: "claude-code",
        prompt: strongPrompt
      })
    });
    const body = await readJson(response);

    assert.equal(body.ok, true);
    assert.equal(body.mode, "prompt-only");
    assert.equal(body.target, "claude-code");
    assert.match(body.prompt, /You are Claude Code acting as an independent production verifier/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("send target code-copilot returns second-opinion prompt", async () => {
  const response = await sendEndpoint({
    request: jsonRequest("https://codex-links.pages.dev/api/prompt-router/send", {
      ...financePayload,
      target: "code-copilot",
      prompt: strongPrompt
    })
  });
  const body = await readJson(response);

  assert.equal(body.ok, true);
  assert.equal(body.mode, "prompt-only");
  assert.match(body.prompt, /You are Code Copilot/);
});

test("send target codex safely falls back when command dispatch is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("not found", { status: 404 });

  try {
    const response = await sendEndpoint({
      request: jsonRequest("https://codex-links.pages.dev/api/prompt-router/send", {
        ...financePayload,
        target: "codex",
        prompt: strongPrompt
      })
    });
    const body = await readJson(response);

    assert.equal(body.ok, true);
    assert.equal(body.mode, "prompt-only");
    assert.equal(body.target, "codex");
    assert.equal(body.dispatch.attempted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("claude and code copilot wrappers are available", () => {
  assert.match(buildClaudeVerificationPrompt({ ...financePayload, prompt: strongPrompt }), /Corrected Codex prompt/);
  assert.match(buildCodeCopilotReviewPrompt({ ...financePayload, prompt: strongPrompt }), /Prompt score from 0-10/);
});
