# Prompt Router

Prompt Router is a mobile-friendly Codex Links workflow for Ezohata Debugger prompts.

## Purpose

The user prepares a debugging prompt in ChatGPT, opens `/prompt-router`, verifies and rewrites the prompt, then routes it to Codex, Claude Code, Code Copilot review, GitHub issue fallback, or copy fallback.

This is not a required OpenAI API integration. The MVP verifier is deterministic and local.

## Who verifies prompt quality?

### Stage 1: Local Prompt Verifier

`POST /api/prompt-router/verify` runs a deterministic checklist verifier. It is fast, free, and does not require `OPENAI_API_KEY`.

It checks whether the prompt is structurally safe and complete enough for Codex.

### Stage 2: External verifier targets

Prompt Router can prepare prompts for deeper external review:

- `claude-code`: independent production verification / deep diagnosis prompt.
- `code-copilot`: independent second-opinion prompt review.

If no external adapter is configured, these targets return copyable prompt-only fallback.

## Lamp colors

The verifier returns `lampStatuses` for UI rendering.

| Color | Meaning |
| --- | --- |
| green | Criterion is satisfied. |
| yellow | Criterion is partially covered, but should be strengthened. |
| red | Criterion is missing and should be added. |
| gray | Criterion is not applicable for this category/project. |

## Core criteria

General prompt checks:

- repo is specified
- user problem/report is included
- exact phrase is present: `First prove the failing layer before patching.`
- current deploy/source of truth check
- latest PR/commit check
- minimal safe patch instruction
- no secrets/env changes instruction
- no architecture rewrite instruction
- regression tests required
- `node --test tests/*.test.*`
- `bash scripts/release-guard.sh`
- `npm run build, if available`
- live verification
- output format includes root cause, changed files, checks, risks, before/after evidence

Ezohata Ledger checks:

- `UI → API route → provider/import → normalization → ledger save → balance → analytics`
- `/api/status`
- status/content-type/body excerpt checks
- `amount_net` balance invariant
- do not exclude valid `amount_net` rows only because `source=unknown`
- provider transport separate from balance logic
- gross/net/fee/source semantics preserved
- provider non-JSON errors become structured JSON

## Page

```text
/prompt-router
```

Supported query params:

- `project`
- `repo`
- `liveUrl`
- `category`
- `problem`
- `prompt`

Default Ezohata Ledger preset:

```text
Project: finance
Repo: andylitvinov-design/finance
Live URL: https://ezohata-incoming-ledger.vercel.app
Category: Finance balance issue
```

## API

```text
POST /api/prompt-router/verify
POST /api/prompt-router/send
```

`send` targets:

- `codex`: tries existing `/api/commands` flow with `cloud-via-slack`; falls back to prompt-only.
- `claude-code`: wraps prompt for independent Claude Code verification; tries existing Claude route; falls back to prompt-only.
- `code-copilot`: returns copyable second-opinion review prompt until an independent no-API Code Copilot bridge exists.
- `github-issue`: returns issue-ready prompt until a safe issue adapter exists.
- `copy`: always returns prompt-only.

## Command polling and result return

If `POST /api/prompt-router/send` creates a command, it returns:

```json
{
  "ok": true,
  "mode": "codex-dispatch",
  "commandId": "cmd_...",
  "pollUrl": "/api/commands?id=cmd_...",
  "status": "queued"
}
```

The page loads `polling.js`, which listens for send responses and polls:

```text
GET /api/commands?id=<commandId>
```

The `Execution Result` panel shows:

- commandId
- status
- actualExecutor / requestedExecutor
- fallbackReason
- deliveryStatus
- resultAt / completedAt
- PR URL
- production URL
- errorMessage
- reply text if it is present in the command response

Polling stops when status becomes one of:

```text
answered
failed
acked
```

or after the timeout. The user can also stop polling manually.

## Code Copilot behavior

The user decision is: Code Copilot must be a separate independent reviewer agent, without OpenAI API and without extra API-token billing.

Therefore the current MVP does **not** route Code Copilot through Claude and does **not** use OpenAI API.

Until a real no-API Code Copilot bridge exists, `target=code-copilot` returns:

```json
{
  "ok": true,
  "mode": "prompt-only",
  "target": "code-copilot",
  "status": "code_copilot_bridge_not_configured",
  "prompt": "..."
}
```

The UI should display:

```text
Code Copilot bridge is not configured. Prompt prepared for manual independent review.
```

Future Code Copilot bridge requirements:

- no OpenAI API
- no extra API billing
- separate independent reviewer
- consumes queued command or equivalent no-API bridge input
- returns answer through the existing `/api/commands` answer/progress lifecycle
- works with the same `Execution Result` polling panel

## Bridge verification

For production confidence, run and record:

```bash
npm run cloud:check
npm run cloud:smoke
npm run claude:smoke
```

Codex route is healthy only if the final executor is the approved Codex route, normally `cloud-via-slack`.

Claude route is healthy only if a Claude command reaches `answered` or returns a clear actionable failure.

## Security

Prompt Router redacts common secret patterns before verification, rewrite, and send handling. It logs only safe metadata such as project, repo, category, target, prompt length, and result mode.

It does not introduce a required `OPENAI_API_KEY` path.