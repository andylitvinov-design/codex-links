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
- `code-copilot`: returns copyable second-opinion review prompt until an adapter exists.
- `github-issue`: returns issue-ready prompt until a safe issue adapter exists.
- `copy`: always returns prompt-only.

## Security

Prompt Router redacts common secret patterns before verification, rewrite, and send handling. It logs only safe metadata such as project, repo, category, target, prompt length, and result mode.

It does not introduce a required `OPENAI_API_KEY` path.
