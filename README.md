# Codex Links

Cloudflare Pages inbox for links and Codex tasks, with production cloud execution routed through Slack-backed Codex Cloud by default and direct OpenAI kept as an optional path.

## Current Architecture

- Public UI and API: Cloudflare Pages
- Primary executor: `Codex Cloud via Slack`
- Secondary executor: local bridge on Mac
- Optional executor: `Direct OpenAI cloud`
- Source repo for cloud tasks: `andylitvinov-design/codex-links`

Delivery pipeline is intentionally narrow:

- `UI -> POST /api/commands -> create command -> dispatch once -> executor ack/result -> ingest -> UI`

Operational rules now are:

- `POST /api/commands` creates and dispatches only the new command
- `GET /api/commands` and `GET /api/status` are read-only
- `POST /api/commands` is the primary cloud execution path
- fallback is one-shot only and ordered as `direct-openai -> cloud-via-slack -> local-bridge`
- stale timeout recovery and legacy reply sync moved out of hot paths into admin maintenance

## What The App Does

- Stores links in Cloudflare KV
- Accepts commands from the mobile UI through `POST /api/commands`
- Dispatches cloud commands to Slack-backed Codex Cloud by default
- Keeps direct OpenAI Responses API available for explicit opt-in
- Mirrors assistant replies and PR links back into the mobile timeline

## Delivery Maintenance

Admin maintenance endpoint:

- `POST /api/admin/commands-maintenance`

This endpoint is authorized-only and is the place for:

- stale timeout evaluation
- one-shot fallback application
- optional legacy Slack reply sync
- redispatch of commands that were switched to cloud during maintenance

Normal UI polling must not depend on this endpoint.

## Saved Audit Notes

Latest saved context-routing summary:

- repo copy: [docs/project-context-audit-2026-04-17.md](/Users/andriilitvinov/projects/MYPROJECTS/links/docs/project-context-audit-2026-04-17.md)
- static online copy after deploy: `/project-context-audit-2026-04-17.md`
- weekly error and findings log: [docs/weekly-errors-and-findings-2026-04-17.md](/Users/andriilitvinov/projects/MYPROJECTS/links/docs/weekly-errors-and-findings-2026-04-17.md)

## Saved Rollback Point

Current preserved live rollback target:

- production build: `20260418-1518`
- git commit: `53691ee7af31c3353bb4023cf0cd5fff0cdacdc0`
- git tag: `saved/live-20260418-1518`
- verification date: `2026-04-18`

Why this point matters:

- it is the confirmed live point where photo delivery is working again
- `Bridge` photo requests reach `answered`
- `Cloud` photo requests safely route into local bridge and also reach `answered`

Before any future rollback or risky deploy check this anchor first.

## Project To Repo Alignment

Rule for this workspace:

- one Codex project folder with its own `README.md` + `STATE.md` should map to one GitHub repository root
- shared repos across several independent Codex project documents should be treated as transitional, not canonical

Verified on `2026-04-16`:

| Codex project docs | GitHub repo | Status |
| --- | --- | --- |
| `links/README.md` + `links/STATE.md` | `andylitvinov-design/codex-links` | dedicated |
| `artefacts/README.md` + `artefacts/STATE.md` | `andylitvinov-design/artefacts` | dedicated |
| `alchemist/README.md` + `alchemist/STATE.md` | `andylitvinov-design/alchemist` | dedicated |
| `sales/README.md` + `sales/STATE.md` | `andylitvinov-design/sales` | dedicated |
| `ezohata/README.md` + `ezohata/STATE.md` | `andylitvinov-design/ezohata` | dedicated ops repo |
| `active-projects-ops/system-optimization/README.md` + `STATE.md` | `andylitvinov-design/active-projects-ops` | shared repo, not 1:1 |

Still unverified from the current `links` inventory:

- `Advice`
- `Brain Management`
- `Books`

For these projects, `links` currently has live URLs but no verified GitHub repo mapping in the nearby workspace.

Thread sync check on `2026-04-16`:

- `codex-links` currently exposes live chat categories for `links`, `artefacts`, `alchemist`, `sales`, and `ezohata`
- `links-inbox` heartbeat must stay `ACTIVE`; it now runs `scripts/run-links-bridge.sh`, which syncs Codex threads before starting the bridge loop

## Command Lifecycle

Production statuses:

- `queued`
- `dispatched`
- `processing`
- `answered`
- `failed`

Normalized delivery fields stored on commands:

- `requestedExecutor`
- `actualExecutor`
- `fallbackCount`
- `fallbackReason`
- `firstAckAt`
- `resultAt`
- `replyMatched`
- `replyMatchedBy`
- `timeoutPhase`

Legacy status:

- `acked`

The UI still renders old `acked` records, but new cloud-executed tasks should move through the cloud-native lifecycle above.

## Required Secrets

Set these in Cloudflare Pages for project `codex-links`:

```bash
npx wrangler pages secret put LINKS_WRITE_TOKEN --project-name codex-links
npx wrangler pages secret put OPENAI_API_KEY --project-name codex-links
npx wrangler pages secret put COMMAND_DISPATCH_MODE --project-name codex-links
```

Slack cloud secrets:

```bash
npx wrangler pages secret put SLACK_BOT_TOKEN --project-name codex-links
npx wrangler pages secret put SLACK_SIGNING_SECRET --project-name codex-links
npx wrangler pages secret put SLACK_CODEX_CHANNEL_ID --project-name codex-links
npx wrangler pages secret put SLACK_CODEX_USER_ID --project-name codex-links
```

Recommended values:

- `COMMAND_DISPATCH_MODE=cloud-via-slack`
- `COMMAND_DISPATCH_MODE=direct-openai` only when you explicitly want direct OpenAI as default
- Keep `OPENAI_API_KEY` only in the Pages environment when direct mode is needed
- Slack variables are the default production route

## Cloud Setup

1. Set Slack secrets in the Cloudflare Pages project.
2. Set `COMMAND_DISPATCH_MODE=cloud-via-slack`.
3. If you need the optional direct path, also set `OPENAI_API_KEY`.
4. Run `npm run cloud:check`.
5. Run `npm run cloud:smoke`.

Quick helpers added to this repo:

- Slack app manifest for legacy maintenance: [integrations/slack/codex-links-app-manifest.yml](/Users/andriilitvinov/projects/MYPROJECTS/links/integrations/slack/codex-links-app-manifest.yml)
- Local/prod setup check: `npm run cloud:check`
- End-to-end text smoke for the default Slack cloud path: `npm run cloud:smoke`
- End-to-end text smoke for the optional direct path: `CODEX_LINKS_SMOKE_CLOUD_ROUTE=direct npm run cloud:smoke`
- Bulk Pages secret upload from `.dev.vars`: `npm run cloud:install-secrets`
- KV-backed runtime config upload from `.dev.vars`: `npm run cloud:save-config`

If you do not want to manage Cloudflare Pages settings manually, `cloud:save-config` can store non-secret runtime settings in KV using only `LINKS_WRITE_TOKEN`. Keep `OPENAI_API_KEY` in the Pages environment; do not store it in KV.

## Local Development

1. Copy `.dev.vars.example` to `.dev.vars`
2. Fill in the required secrets
3. Install dependencies

```bash
npm install
```

4. Run local Pages dev

```bash
npm run dev
```

## Deploy

Production flow is now fixed as:

- `branch -> PR -> merge -> Pages deploy`
- `main` is the only production branch
- do not batch merges for later release; each merged production fix must be deployed to live immediately in the same work session
- ChatGPT/Codex changes are complete only after a commit or PR exists and the deploy status is known

Expected platform setup for this repo:

- GitHub repo `andylitvinov-design/codex-links` connected to Cloudflare Pages project `codex-links`
- PR preview deployments enabled
- production deploys only from `main`
- after merge and Pages deploy, the client auto-detects a newer `public/version.json` build on boot, during polling, and when the tab regains focus; users do not need to tap `Refresh`

Emergency rollback flow:

- Git rollback: `node scripts/revert-last-good.mjs --commit <bad-commit-sha> --push`
- Platform rollback: redeploy the previous known-good Cloudflare Pages deployment, then merge the revert PR

Manual `npm run deploy` remains available as an operator fallback, not as the normal release path.

```bash
npm run deploy
```

## APIs

### Export to Excel-compatible CSV

Choose a period with `from=YYYY-MM-DD` and `to=YYYY-MM-DD`, then export one dataset or everything:

```bash
curl -L "https://<your-domain>/api/export?dataset=all&from=2026-04-01&to=2026-04-15&clientId=<client-id>" -o codex-links-export.csv
```

Available datasets:

- `all`
- `commands`
- `messages`
- `links`

Notes:

- the UI now exposes the same export flow directly in the page
- `commands` and `messages` export only what is still available in current app history retention
- `links` export is filtered by `createdAt` across the stored links list

### Links

```bash
curl -X POST "https://<your-domain>/api/links" \
  -H "Content-Type: application/json" \
  -H "X-Write-Token: <LINKS_WRITE_TOKEN>" \
  -d '{
    "url": "https://example.com/page.html",
    "title": "Example page",
    "note": "Собрано после генерации HTML",
    "tags": ["html", "client"],
    "source": "codex"
  }'
```

### Commands

```bash
curl -X POST "https://<your-domain>/api/commands" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "обнови последнюю ссылку и открой PR",
    "clientId": "phone-client",
    "threadId": "links",
    "threadLabel": "Links"
  }'
```

### Slack inbound

Slack sends signed webhook events to:

```text
POST /api/slack
```

The handler is kept only for legacy maintenance. Normal cloud command success must not depend on `/api/slack`.

## Notes

- Photo-only cloud requests are intentionally blocked in v1. Text commands are the first-class path for direct cloud execution.
- The local bridge scripts remain in the repo as manual fallback tooling, but they are no longer the primary production architecture.
- `codex-links` should now be treated as done only when GitHub has the branch or PR and Cloudflare has a corresponding deploy status.
