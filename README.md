# Codex Links

Cloudflare Pages inbox for links and Codex tasks, with production cloud execution routed through a private trusted cloud bridge running on a machine that is already logged into Codex via ChatGPT.

## Current Architecture

- Public UI and API: Cloudflare Pages
- Primary executor: `Trusted Codex Cloud`
- Secondary executor: local bridge on Mac
- Source repo for cloud tasks: `andylitvinov-design/codex-links`

Delivery pipeline is intentionally narrow:

- `UI -> POST /api/commands -> create command -> dispatch once -> executor ack/result -> ingest -> UI`

Operational rules now are:

- `POST /api/commands` creates and dispatches only the new command
- `GET /api/commands` and `GET /api/status` are read-only
- `POST /api/commands` is the primary cloud execution path
- stale timeout recovery and bridge-to-cloud reroute live in admin maintenance
- legacy Slack records remain readable, but new production cloud dispatch must not depend on Slack or API keys

## What The App Does

- Stores links in Cloudflare KV
- Accepts commands from the mobile UI through `POST /api/commands`
- Dispatches cloud commands to a private trusted cloud bridge
- Mirrors assistant replies and PR links back into the mobile timeline

## Delivery Maintenance

Admin maintenance endpoint:

- `POST /api/admin/commands-maintenance`

This endpoint is authorized-only and is the place for:

- stale timeout evaluation
- one-shot fallback application
- optional legacy Slack reply sync for old records only
- redispatch of commands that were switched to cloud during maintenance

Normal UI polling must not depend on this endpoint.

## Trusted Cloud Mode

Production Cloud mode is:

- `browser -> Cloudflare Pages -> private cloud bridge -> local Codex CLI using existing ChatGPT login`

Important boundaries:

- the browser never talks directly to the private bridge
- the browser never receives Codex auth material
- Pages never stores or proxies local Codex login state
- the private bridge authenticates Pages requests with an HMAC shared secret
- the private bridge pushes progress and results back through `/api/commands`, `/api/messages`, and `/api/status`

Security notes and limitations:

- this is a personal trusted setup, not a public multi-user execution service
- do not expose `CLOUD_BRIDGE_SHARED_SECRET`, `LINKS_WRITE_TOKEN`, or any local Codex auth files to the browser
- keep the private bridge bound to a private interface or a private tunnel only
- if the trusted machine is offline, Cloud mode should fail clearly; it should not silently fall back to API-key or Slack execution

Minimal diagnostics:

- Pages executor status: `GET /api/status`
- Browser-visible command lifecycle: `GET /api/commands?id=<command-id>`
- Private bridge readiness: `GET /healthz` on the trusted bridge
- Local checks: `npm run cloud:check`, `npm run cloud:smoke`, `npm run cloud:photo-smoke`

## Saved Audit Notes

Latest saved context-routing summary:

- repo copy: [docs/project-context-audit-2026-04-17.md](/Users/andriilitvinov/projects/MYPROJECTS/links/docs/project-context-audit-2026-04-17.md)
- static online copy after deploy: `/project-context-audit-2026-04-17.md`
- weekly error and findings log: [docs/weekly-errors-and-findings-2026-04-17.md](/Users/andriilitvinov/projects/MYPROJECTS/links/docs/weekly-errors-and-findings-2026-04-17.md)

Latest saved live rollback point:

- production build: `20260418-1518`
- verified on: `2026-04-18`
- verified paths:
  - `Bridge` photo -> `answered`
  - `Cloud` photo -> auto-route to local bridge for photo -> `answered`
- notification written to app tab `Уведомления`: `notification:all-good:20260418-1708`

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
- `cloudJobId`
- `progressMessage`

Legacy status:

- `acked`

The UI still renders old `acked` records, but new cloud-executed tasks should move through the cloud-native lifecycle above.

## Required Secrets

Set these in Cloudflare Pages for project `codex-links`:

```bash
npx wrangler pages secret put LINKS_WRITE_TOKEN --project-name codex-links
npx wrangler pages secret put COMMAND_DISPATCH_MODE --project-name codex-links
npx wrangler pages secret put CLOUD_BRIDGE_BASE_URL --project-name codex-links
npx wrangler pages secret put CLOUD_BRIDGE_SHARED_SECRET --project-name codex-links
```

Optional Pages runtime config:

```bash
npx wrangler pages secret put CLOUD_BRIDGE_REQUEST_TIMEOUT_MS --project-name codex-links
```

Recommended values:

- `COMMAND_DISPATCH_MODE=cloud`
- `CLOUD_BRIDGE_BASE_URL` should point at the private bridge URL, not a public browser-facing URL
- `CLOUD_BRIDGE_SHARED_SECRET` must match the trusted machine value exactly

Trusted machine environment:

```bash
export LINKS_BASE_URL="https://codex-links.pages.dev"
export LINKS_WRITE_TOKEN="<pages-write-token>"
export CLOUD_BRIDGE_SHARED_SECRET="<same-shared-secret>"
export CLOUD_BRIDGE_BIND_HOST="127.0.0.1"
export CLOUD_BRIDGE_PORT="8788"
export CODEX_BIN="/Users/andriilitvinov/.npm-global/bin/codex"
```

## Cloud Setup

1. Set the Pages secrets for `LINKS_WRITE_TOKEN`, `COMMAND_DISPATCH_MODE`, `CLOUD_BRIDGE_BASE_URL`, and `CLOUD_BRIDGE_SHARED_SECRET`.
2. Start the trusted machine bridge with `npm run cloud:bridge:start`.
3. Run `npm run cloud:check`.
4. Run `npm run cloud:smoke`.
5. Run `npm run cloud:photo-smoke`.

Quick helpers added to this repo:

- Private bridge server: `npm run cloud:bridge:start`
- Local/prod setup check: `npm run cloud:check`
- End-to-end text smoke for trusted cloud: `npm run cloud:smoke`
- End-to-end photo smoke for trusted cloud: `npm run cloud:photo-smoke`
- Bulk Pages secret upload from `.dev.vars`: `npm run cloud:install-secrets`
- KV-backed runtime config upload from `.dev.vars`: `npm run cloud:save-config`

If you do not want to manage Cloudflare Pages settings manually, `cloud:save-config` can store non-secret runtime settings in KV using only `LINKS_WRITE_TOKEN`. Keep `CLOUD_BRIDGE_SHARED_SECRET` in the Pages environment; do not store it in KV.

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

Legacy only for historical reply ingestion and maintenance. New production Cloud mode must not depend on this path.

Slack sends signed webhook events to:

```text
POST /api/slack
```

The handler is kept only for legacy maintenance. Normal cloud command success must not depend on `/api/slack`.

## Notes

- Photo-only cloud requests are intentionally blocked in v1. Text commands are the first-class path for direct cloud execution.
- The local bridge scripts remain in the repo as manual fallback tooling, but they are no longer the primary production architecture.
- `codex-links` should now be treated as done only when GitHub has the branch or PR and Cloudflare has a corresponding deploy status.
