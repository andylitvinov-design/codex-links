import { redactSecrets } from "./prompt-router-security.js";

export const EZOHATA_LAYER_CHAIN = "UI → API route → provider/import → normalization → ledger save → balance → analytics";
export const FAILING_LAYER_PHRASE = "First prove the failing layer before patching.";

const FINANCE_DEFAULT_REPO = "andylitvinov-design/finance";
const FINANCE_DEFAULT_URL = "https://ezohata-incoming-ledger.vercel.app";

const REQUIRED_CHECKS = [
  {
    id: "repo",
    label: "Repo is specified",
    test: ({ prompt, repo }) => includesAny(prompt, [repo, FINANCE_DEFAULT_REPO]),
    partial: ({ prompt }) => /repo|repository|github/i.test(prompt)
  },
  {
    id: "problem",
    label: "User problem/report is included",
    test: ({ prompt, problem }) => Boolean(String(problem || "").trim()) || /user report|problem|поблем|проблем|ошиб|bug|issue/i.test(prompt),
    partial: ({ prompt }) => /fix|исправ|проверь|debug/i.test(prompt)
  },
  {
    id: "failing-layer-phrase",
    label: `Includes exact phrase: ${FAILING_LAYER_PHRASE}`,
    test: ({ prompt }) => prompt.includes(FAILING_LAYER_PHRASE),
    partial: ({ prompt }) => /failing layer|layer|слой|root cause/i.test(prompt)
  },
  {
    id: "deploy-source",
    label: "Current deploy/source of truth check",
    test: ({ prompt }) => /deploy|source of truth|commitSha|commit sha|\/api\/status|статус|деплой/i.test(prompt),
    partial: ({ prompt }) => /production|prod|live|commit|версия/i.test(prompt)
  },
  {
    id: "latest-commits",
    label: "Latest PR/commit check",
    test: ({ prompt }) => /latest PR|latest commit|recent PR|commits?|последн.*PR|последн.*commit|коммит/i.test(prompt),
    partial: ({ prompt }) => /PR|pull request|commit|branch|ветк/i.test(prompt)
  },
  {
    id: "minimal-patch",
    label: "Minimal safe patch instruction",
    test: ({ prompt }) => /minimal safe patch|minimal patch|surgical|минимальн/i.test(prompt),
    partial: ({ prompt }) => /patch|fix|исправ/i.test(prompt)
  },
  {
    id: "no-secrets",
    label: "No secrets/env changes instruction",
    test: ({ prompt }) => /no secrets|do not.*secrets|do not.*env|не.*secret|не.*env|секрет/i.test(prompt),
    partial: ({ prompt }) => /secret|env|token|key|ключ/i.test(prompt)
  },
  {
    id: "no-rewrite",
    label: "No architecture rewrite instruction",
    test: ({ prompt }) => /no architecture rewrite|do not rewrite architecture|не перепис/i.test(prompt),
    partial: ({ prompt }) => /architecture|архитект/i.test(prompt)
  },
  {
    id: "regression-tests",
    label: "Regression tests required",
    test: ({ prompt }) => /regression tests?|tests?|тест/i.test(prompt),
    partial: ({ prompt }) => /check|проверк/i.test(prompt)
  },
  {
    id: "node-test",
    label: "node --test verification command",
    test: ({ prompt }) => /node\s+--test\s+tests\/\*\.test\.\*/i.test(prompt),
    partial: ({ prompt }) => /node --test|node test|tests\/|npm test/i.test(prompt)
  },
  {
    id: "release-guard",
    label: "release guard verification command",
    test: ({ prompt }) => /scripts\/release-guard\.sh|release-guard/i.test(prompt),
    partial: ({ prompt }) => /guard|release|smoke/i.test(prompt)
  },
  {
    id: "build-command",
    label: "npm run build if available",
    test: ({ prompt }) => /npm run build|build,? if available/i.test(prompt),
    partial: ({ prompt }) => /build/i.test(prompt)
  },
  {
    id: "live-verification",
    label: "Live verification required",
    test: ({ prompt }) => /live verification|live verify|production verification|провер.*live|провер.*prod/i.test(prompt),
    partial: ({ prompt }) => /live|prod|production|browser|site|сайт/i.test(prompt)
  },
  {
    id: "output-format",
    label: "Output format includes root cause/changed files/checks/risks/evidence",
    test: ({ prompt }) => /root cause/i.test(prompt) && /changed files/i.test(prompt) && /checks/i.test(prompt) && /risks/i.test(prompt),
    partial: ({ prompt }) => /root cause|changed files|checks|risks|evidence|отчет/i.test(prompt)
  }
];

const FINANCE_REQUIRED_CHECKS = [
  {
    id: "finance-chain",
    label: `Ezohata layer chain: ${EZOHATA_LAYER_CHAIN}`,
    test: ({ prompt }) => prompt.includes(EZOHATA_LAYER_CHAIN),
    partial: ({ prompt }) => /UI|API|provider|normalization|ledger|balance|analytics|аналит/i.test(prompt)
  },
  {
    id: "api-status",
    label: "Check /api/status",
    test: ({ prompt }) => prompt.includes("/api/status"),
    partial: ({ prompt }) => /status|commitSha|health/i.test(prompt)
  },
  {
    id: "content-type-body",
    label: "Check status/content-type/body excerpt",
    test: ({ prompt }) => /content-type|first 300|body excerpt|status/i.test(prompt),
    partial: ({ prompt }) => /body|response|endpoint|network|api/i.test(prompt)
  },
  {
    id: "amount-net",
    label: "Preserve amount_net balance invariant",
    test: ({ prompt }) => /amount_net/i.test(prompt),
    partial: ({ prompt }) => /balance|net|баланс/i.test(prompt)
  },
  {
    id: "source-unknown",
    label: "Do not exclude valid amount_net rows because source=unknown",
    test: ({ prompt }) => /source=unknown|source unknown|unknown source/i.test(prompt),
    partial: ({ prompt }) => /source|unknown/i.test(prompt)
  },
  {
    id: "provider-transport",
    label: "Provider transport separate from balance logic",
    test: ({ prompt }) => /provider transport|transport.*balance|provider.*balance/i.test(prompt),
    partial: ({ prompt }) => /provider|transport|import/i.test(prompt)
  },
  {
    id: "gross-net-fee",
    label: "Preserve gross/net/fee/source semantics",
    test: ({ prompt }) => /gross.*net.*fee|net.*gross.*fee|fee.*net.*gross/i.test(prompt),
    partial: ({ prompt }) => /gross|net|fee|source/i.test(prompt)
  },
  {
    id: "non-json-errors",
    label: "Provider non-JSON errors become structured JSON",
    test: ({ prompt }) => /non-JSON|structured JSON|SyntaxError|HTML|plain text/i.test(prompt),
    partial: ({ prompt }) => /JSON|SyntaxError|HTML|provider error/i.test(prompt)
  }
];

function includesAny(text, needles) {
  return needles.filter(Boolean).some((needle) => text.includes(String(needle)));
}

function lampStatusForCheck(check, context, applicable = true) {
  if (!applicable) {
    return {
      id: check.id,
      label: check.label,
      status: "not_applicable",
      color: "gray"
    };
  }

  if (check.test(context)) {
    return {
      id: check.id,
      label: check.label,
      status: "pass",
      color: "green"
    };
  }

  if (typeof check.partial === "function" && check.partial(context)) {
    return {
      id: check.id,
      label: check.label,
      status: "partial",
      color: "yellow"
    };
  }

  return {
    id: check.id,
    label: check.label,
    status: "missing",
    color: "red"
  };
}

export function isFinanceTask(payload = {}) {
  const joined = [payload.project, payload.repo, payload.liveUrl, payload.category, payload.problem, payload.prompt]
    .map((value) => String(value || "").toLowerCase())
    .join("\n");

  return joined.includes("finance")
    || joined.includes("ezohata")
    || joined.includes("ledger")
    || joined.includes("balance")
    || joined.includes("аналит")
    || joined.includes("остат")
    || joined.includes("provider")
    || joined.includes("paypal")
    || joined.includes("wise");
}

export function normalizePromptRouterPayload(payload = {}) {
  const project = String(payload.project || "finance").trim() || "finance";
  const finance = isFinanceTask({ ...payload, project });
  const repo = String(payload.repo || (finance ? FINANCE_DEFAULT_REPO : "")).trim();
  const liveUrl = String(payload.liveUrl || (finance ? FINANCE_DEFAULT_URL : "")).trim();
  const category = String(payload.category || (finance ? "Finance balance issue" : "Bug fix")).trim();
  const problem = redactSecrets(String(payload.problem || "").trim());
  const prompt = redactSecrets(String(payload.prompt || "").trim());

  return {
    project,
    repo,
    liveUrl,
    category,
    problem,
    prompt,
    finance: isFinanceTask({ project, repo, liveUrl, category, problem, prompt })
  };
}

export function verifyPromptRouterPrompt(payload = {}) {
  const normalized = normalizePromptRouterPayload(payload);
  const prompt = normalized.prompt;

  if (!prompt) {
    return {
      ok: false,
      error: "validation_error",
      message: "prompt is required"
    };
  }

  const context = { ...normalized, prompt };
  const generalLampStatuses = REQUIRED_CHECKS.map((check) => lampStatusForCheck(check, context));
  const financeLampStatuses = FINANCE_REQUIRED_CHECKS.map((check) => lampStatusForCheck(check, context, normalized.finance));
  const applicableLampStatuses = [...generalLampStatuses, ...financeLampStatuses].filter((entry) => entry.status !== "not_applicable");
  const allLampStatuses = [...generalLampStatuses, ...financeLampStatuses];
  const passedChecks = applicableLampStatuses
    .filter((entry) => entry.status === "pass")
    .map((entry) => entry.label);
  const partialChecks = applicableLampStatuses
    .filter((entry) => entry.status === "partial")
    .map((entry) => entry.label);
  const missingRequiredItems = applicableLampStatuses
    .filter((entry) => entry.status === "missing" || entry.status === "partial")
    .map((entry) => entry.label);

  const rawScore = applicableLampStatuses.length
    ? ((passedChecks.length + partialChecks.length * 0.5) / applicableLampStatuses.length) * 10
    : 0;
  const score = Math.round(rawScore * 10) / 10;
  const weaknesses = missingRequiredItems.map((item) => `Missing or partial: ${item}`);
  const recommendations = missingRequiredItems.map((item) => `Add or strengthen: ${item}`);
  const rewrittenPrompt = buildRewrittenPrompt(normalized, missingRequiredItems);

  return {
    ok: true,
    score,
    verdict: buildVerdict(score),
    problemUnderstanding: buildProblemUnderstanding(normalized),
    weaknesses,
    recommendations,
    missingRequiredItems,
    passedChecks,
    partialChecks,
    lampStatuses: allLampStatuses,
    rewrittenPrompt
  };
}

function buildVerdict(score) {
  if (score >= 9) return "production_ready";
  if (score >= 7) return "good_but_verify_missing_items";
  if (score >= 4) return "usable_but_incomplete";
  return "weak_or_unsafe_prompt";
}

function buildProblemUnderstanding(payload) {
  if (payload.finance) {
    return "Ezohata Ledger debugging task. The prompt must prove the failing layer before patching and preserve finance balance/provider semantics.";
  }

  return "General code/debugging task. The prompt must identify the failing layer, require a minimal patch, and define verification steps.";
}

export function buildRewrittenPrompt(payload = {}, missingItems = []) {
  const normalized = normalizePromptRouterPayload(payload);
  const userPrompt = normalized.prompt;
  const problem = normalized.problem || "[Add the user report/problem here]";
  const financeBlock = normalized.finance ? `
Ezohata Ledger failing-layer chain:
${EZOHATA_LAYER_CHAIN}

Finance invariants:
- Balance uses amount_net.
- Valid amount_net rows must not be excluded only because source=unknown.
- Provider transport is separate from balance logic.
- Do not change gross/net/fee/source semantics without proof.
- Provider non-JSON errors must become structured JSON errors, not raw SyntaxError/HTML/plain text.
` : "";

  const missingBlock = missingItems.length
    ? `\nPrompt QA missing items to cover:\n${missingItems.map((item) => `- ${item}`).join("\n")}\n`
    : "";

  return `${normalized.repo ? `Repo: ${normalized.repo}\n` : ""}${normalized.liveUrl ? `Live URL: ${normalized.liveUrl}\n` : ""}Category: ${normalized.category}

User report:
${problem}

${FAILING_LAYER_PHRASE}

Task:
Find the root cause before patching. Do not list broad equal hypotheses if live responses or code can eliminate layers. If the root cause is not proven, write: likely bug in [layer], needs verification.
${financeBlock}
Required live/debug checks:
- Check current deploy/source of truth, including /api/status when available.
- Check latest PRs/commits touching the affected layer.
- For runtime/API issues, capture method, status, content-type, first 300 chars of body, and how the response is parsed in code.
- Prove evidence for and evidence against the claimed failing layer.

Implementation constraints:
- Make a minimal safe patch.
- Do not rewrite architecture.
- Do not change secrets/env.
- Do not change finance semantics unless the root cause proves it is necessary.
- Add regression tests that cover the user-visible bug.

Verification commands:
- node --test tests/*.test.*
- bash scripts/release-guard.sh
- npm run build, if available

Live verification:
- Re-check the affected URL/endpoints after the patch.
- Capture before/after evidence.

Output:
1. Root cause / failing layer
2. Evidence for
3. Evidence against
4. Changed files
5. Tests/checks run
6. Live verification
7. Risks remaining
${missingBlock}
Original prompt/context:
${userPrompt}`.trim();
}

export function buildClaudeVerificationPrompt(payload = {}) {
  const normalized = normalizePromptRouterPayload(payload);
  return `You are Claude Code acting as an independent production verifier.

Repo: ${normalized.repo || "[repo]"}
Live URL: ${normalized.liveUrl || "[live URL if available]"}
Category: ${normalized.category}

Do not patch first. First prove or reject the failing layer.

Review this prompt/task for correctness and completeness:

${normalized.prompt}

Check:
1. Whether the problem is understood correctly.
2. Whether the prompt forces proof of the failing layer before patching.
3. Whether live/deploy/source mismatch checks are included.
4. Whether tests reproduce the actual user-visible bug.
5. Whether the patch is constrained to a minimal safe change.
6. Whether secrets/env and architecture are protected.
7. For Ezohata Ledger, whether amount_net, source=unknown, provider transport, gross/net/fee/source semantics are preserved.

Output:
1. Verdict: pass / fail / needs verification
2. Proven or missing failing-layer evidence
3. Prompt weaknesses
4. Short recommendations
5. Corrected Codex prompt`;
}

export function buildCodeCopilotReviewPrompt(payload = {}) {
  const normalized = normalizePromptRouterPayload(payload);
  return `You are Code Copilot, a senior programming assistant and independent prompt reviewer.

Repo: ${normalized.repo || "[repo]"}
Live URL: ${normalized.liveUrl || "[live URL if available]"}
Category: ${normalized.category}

Review the following debugging prompt. Do not implement the fix. Evaluate whether it will lead Codex to the correct root cause and safe patch.

Prompt:
${normalized.prompt}

Return:
1. Problem understanding
2. Prompt score from 0-10
3. Missing evidence/checks
4. Risks
5. Brief recommendations
6. Rewritten prompt`;
}
