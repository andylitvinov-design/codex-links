# SAFE.md — codex-links

Last reviewed: 2026-07-19

Purpose: compact repo-level safety map for `/safe`. Store environment-variable names only; never store values, tokens, private payloads, photos, cookies, or provider responses.

## Project boundary

- Canonical repo: `andylitvinov-design/codex-links`
- Production URL: `https://codex-links.pages.dev`
- Related subproject: `codex-save/`, deployed separately at `https://codex-save-cjb.pages.dev`
- Hosting: Cloudflare Pages Functions
- Production branch/source: `main`; exact deployed SHA needs live verification
- Static output: `public`
- Primary storage binding: `LINKS_STORE`
- Project memory: `ai-projects-brain/projects/codex-links/PROJECT.md`

This repo owns the inbox UI, delivery timeline, reports, Slack-backed Codex Cloud command bridge, optional Direct OpenAI path, local/Claude bridge routes, and `codex-save` diagnostics/remediation. Do not confuse a code-path fix with external Slack/OpenAI/worker account readiness.

## Main surfaces

| Surface | Path / endpoint | Access | Main risk |
| --- | --- | --- | --- |
| Inbox / timeline UI | `/` | public | command creation, private operational text, broken delivery states |
| Command API | `/api/commands` | mixed public reads and state-changing writes | unauthorized command dispatch, duplicate work, provider/API cost |
| Delivery API | `/api/delivery` | public read subset plus protected operations | internal delivery metadata exposure, lifecycle mutation |
| Reports API/UI | `/api/reports` and report timeline | public read/write rules vary | stale/private reports, payload spam |
| Admin maintenance | `/api/admin/*` | token required | command mutation or redispatch |
| Slack callbacks/events | function routes | signing/token verification required | replay, forged events, private Slack data |
| `codex-save` remediation | separate Pages project | operator action | creating real commands unintentionally |

## Environment-variable names

Known names include:

- `LINKS_WRITE_TOKEN`
- `ADMIN_TOKEN`
- `COMMAND_DISPATCH_MODE`
- `OPENAI_API_KEY`
- `CLOUD_BRIDGE_BASE_URL`
- `CLOUD_BRIDGE_SHARED_SECRET`
- `SLACK_BOT_TOKEN`
- `SLACK_CODEX_DISPATCH_TOKEN`
- `SLACK_SIGNING_SECRET`
- `SLACK_CODEX_CHANNEL_ID`
- `SLACK_CODEX_USER_ID`
- `SLACK_CODEX_MENTION`
- `LINKS_STORE`
- `SAVE_STORE`

All tokens, signing secrets, shared secrets, and provider keys are server-only. Query-string token compatibility is sensitive because URLs can leak through history, logs, screenshots, and referrers; prefer headers for new clients.

## Required `/safe` routing

1. Command creation/delivery concern → `functions/api/commands.js`, `functions/_lib/commands.js`, `functions/_lib/security.js`, dispatch/provider helpers, `public/app.js`, and focused tests.
2. Slack concern → Slack event/dispatch files, signing validation, actor checks, replay behavior, safe logs, timeout/fallback policy.
3. Direct OpenAI concern → server-only route, authorization, quotas/timeouts, prompt/data retention, safe provider errors.
4. Reports concern → reports API/storage, public serialization, dashboard source links, stale/empty/error states.
5. `codex-save` concern → remediation confirmation, token boundary, KV binding, and proof that no command is created accidentally.
6. Release concern → `public/version.json`, `public/index.html`, `public/app.js`, Cloudflare config, release smoke, and rollback helper.

## Confirmed high-risk finding on current `main`

The default `POST /api/commands` create path currently reaches command insertion and asynchronous dispatch without calling the shared `isAuthorized()` guard. The public UI also submits this create request without a write token. By contrast, maintenance/mutation actions such as acknowledge, answer, claim, requeue, dispatch, and replace explicitly require authorization.

Risk: an unauthenticated caller may be able to create work for Slack-backed Codex Cloud, Direct OpenAI, Claude/local bridge, or a repository-changing target. This can create command spam, external side effects, duplicate work, or provider cost.

Do **not** add a one-line global token requirement blindly: the current public UI has no authenticated write-token exchange, so that patch would break the primary command journey. The safe repair must define and test an owner authentication or short-lived server-issued command capability, then fail closed on unauthenticated creation. Until that is implemented and live-verified, treat public command creation as an open high-severity risk.

A separate related check is required for unauthenticated `GET /api/commands?id=...` and all public serializers: they must not expose photo data, temp paths, local workspace paths, Slack/provider diagnostics, tokens, or internal error detail.

## Security and reliability checks

For the selected route verify:

- every state-changing action has a server-side authorization/capability check;
- public read scopes return only an explicit safe field allowlist;
- command creation has payload size limits, server validation, abuse/rate controls, and duplicate/idempotency behavior;
- photo uploads validate type/size and never expose raw data URLs or temporary paths on public responses;
- Slack callbacks verify signatures/timestamps and reject replay;
- provider retries/timeouts/fallbacks cannot multiply paid calls or create duplicate commands;
- repo-changing requests retain explicit target-repo routing and do not silently dispatch to the wrong repository;
- logs omit tokens, auth headers, complete prompts/photos, private Slack payloads, and raw provider responses;
- public errors are neutral while actionable internal diagnostics remain server-side;
- version triplet/release checks stay aligned before production claims;
- rollback and KV/export status are known before risky lifecycle/storage changes.

## Frontend UX smoke checks

```text
- Open `/` on mobile and desktop; hard refresh and use back/forward.
- Submit empty, text-only, photo, and invalid/oversized photo states.
- Double-click submit and retry after a simulated failure; confirm one command only.
- Check bridge, Claude, Slack cloud, and Direct OpenAI route-unavailable states.
- Confirm pending controls disable and delivery stages remain understandable.
- Open no-results/empty report and message states.
- Confirm no raw error, stack trace, private path, token, data URL, or internal provider payload is visible.
- For codex-save, verify cancel/confirmation before any remediation creates a real command.
```

## Headers / CORS / browser baseline

- CSP or staged CSP plan: needs verification.
- `X-Content-Type-Options`, referrer policy, Permissions-Policy, and frame protection: needs live response verification.
- CORS: public read routes and protected mutation routes must be distinguished; CORS is not an authorization control.
- HSTS: verify live behavior before documenting as passed.

## Verification commands

```bash
npm ci
npm test
npm audit --audit-level=high
npm run smoke:release
npm run cloud:check
git diff --check
```

For an auth/capability repair, add focused regressions proving:

- anonymous create fails closed;
- the intended owner UI can create exactly one command;
- invalid/expired/replayed capability fails;
- existing protected actions remain protected;
- public reads contain no private fields;
- Slack/Direct OpenAI/local fallback is not dispatched after authorization failure.

Do not run real provider/Slack command smoke unless explicitly scoped and safe; it can create external work or cost.

## Observability, rollback, and backup

- Logs: Cloudflare Pages Functions and GitHub Actions; Slack/provider dashboards when relevant.
- Health: `/`, `/version.json`, safe read endpoints, release smoke, cloud setup check.
- Rollback: focused revert or `npm run rollback:prepare`, then reviewed redeploy.
- Backup: Git history; Cloudflare KV export/retention remains `needs verification`.
- Incident owner: Andrey.

## Last `/safe` result

- Date: 2026-07-19
- Routes: Cloudflare command bridge, auth/abuse/cost, public serialization, frontend interaction, release/rollback.
- Critical findings: none proven.
- High findings: unauthenticated default command-create path can reach dispatch; safe replacement auth/capability flow is not present in the public UI.
- Fix applied: safety map corrected so future agents do not assume command creation is token-gated.
- Code fix not applied: a one-line token guard would break the current public UI and was therefore not considered a safe minimal patch.
- Checks run: targeted source review of command handler, shared token helper, public submit flow, package scripts, Cloudflare config, and README.
- Checks not run: dependency install/tests, live API/browser/header smoke, real Slack/OpenAI/bridge dispatch.
- Live verified: no — network/DNS access was unavailable in this run.
- Next action: design and implement a short-lived owner command capability or authenticated owner session in a focused PR, with anonymous-create and no-dispatch regressions.