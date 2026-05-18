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
- `code-copilot`: creates a `code-copilot-bridge` command when `CODE_COPILOT_BRIDGE_ENABLED=true`; otherwise returns prompt-only.
- `github-issue`: returns issue-ready prompt until a safe issue adapter exists.
- `copy`: always returns prompt-only.

## Command polling and result return

If `POST /api/prompt-router/send` creates a command, it returns:

```json
{
  "ok": true,
  "mode": "code-copilot-dispatch",
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

## Code Copilot Local Bridge

The user decision is: Code Copilot must be a separate independent reviewer agent, without OpenAI API and without extra API-token billing.

The implemented bridge is local-only:

```text
/prompt-router
  -> target=code-copilot
  -> /api/prompt-router/send
  -> command dispatchMode=code-copilot-bridge
  -> scripts/code-copilot-bridge.mjs claims command
  -> local model reviews prompt
  -> bridge posts answer through /api/commands action=answer
  -> /prompt-router polls and shows answer
```

Code Copilot commands use dedicated KV queue and processing indexes for `code-copilot-bridge`. The normal claim path reads those indexes first, and the existing snapshot scan remains as defensive recovery if an index is stale.

Supported local providers:

- Ollama: `http://127.0.0.1:11434/api/generate`
- LM Studio: `http://127.0.0.1:1234/v1/chat/completions`

The cloud API does not call OpenAI for Code Copilot.

### Required Cloudflare setting

Enable the code-copilot dispatch path in Cloudflare runtime/config:

```text
CODE_COPILOT_BRIDGE_ENABLED=true
```

If this is absent, `target=code-copilot` returns:

```json
{
  "ok": true,
  "mode": "prompt-only",
  "target": "code-copilot",
  "status": "code_copilot_bridge_not_configured",
  "prompt": "..."
}
```

### Local bridge env

```bash
CODEX_LINKS_BASE_URL=https://codex-links.pages.dev
LINKS_WRITE_TOKEN=...
CODE_COPILOT_LOCAL_PROVIDER=ollama # or lmstudio
CODE_COPILOT_MODEL=qwen2.5-coder:7b
CODE_COPILOT_OLLAMA_URL=http://127.0.0.1:11434/api/generate
CODE_COPILOT_LMSTUDIO_URL=http://127.0.0.1:1234/v1/chat/completions
CODE_COPILOT_POLL_INTERVAL_MS=5000
```

Run manually:

```bash
CODEX_LINKS_BASE_URL=https://codex-links.pages.dev \
LINKS_WRITE_TOKEN=... \
CODE_COPILOT_LOCAL_PROVIDER=ollama \
CODE_COPILOT_MODEL=qwen2.5-coder:7b \
node scripts/code-copilot-bridge.mjs
```

Install as launchd agent:

```bash
CODEX_LINKS_BASE_URL=https://codex-links.pages.dev \
LINKS_WRITE_TOKEN=... \
CODE_COPILOT_LOCAL_PROVIDER=ollama \
CODE_COPILOT_MODEL=qwen2.5-coder:7b \
zsh scripts/install-code-copilot-bridge-launch-agent.sh
```

Logs:

```text
~/Library/Logs/codex-links-code-copilot-bridge.launchd.log
~/Library/Logs/codex-links-code-copilot-bridge.launchd.error.log
```

Smoke local model:

```bash
npm run code-copilot:smoke
```

## Bridge verification

For production confidence, run and record:

```bash
npm run cloud:check
npm run cloud:smoke
npm run claude:smoke
npm run code-copilot:smoke
```

Codex route is healthy only if the final executor is the approved Codex route, normally `cloud-via-slack`.

Claude route is healthy only if a Claude command reaches `answered` or returns a clear actionable failure.

Code Copilot route is healthy only if:

- `CODE_COPILOT_BRIDGE_ENABLED=true`
- local model endpoint responds
- local bridge claims a `code-copilot-bridge` command from the Code Copilot queue
- command reaches `answered`
- `/prompt-router` displays the answer in Execution Result

## Security

Prompt Router redacts common secret patterns before verification, rewrite, and send handling. It logs only safe metadata such as project, repo, category, target, prompt length, and result mode.

Code Copilot bridge logs safe metadata only and does not log raw prompts by default.

It does not introduce a required `OPENAI_API_KEY` path.

The launchd installer writes `LINKS_WRITE_TOKEN` into the local plist `EnvironmentVariables`, matching the existing local bridge pattern. Treat the machine account as trusted, keep the plist private to the operator machine, and prefer a future Keychain, chmod-600 env file, or `launchctl setenv` flow if this bridge is installed on a less trusted Mac.
