# Codex Links

Cloudflare Pages inbox for links and Codex tasks, with production cloud execution routed through Slack-backed Codex Cloud by default and direct OpenAI kept as an optional path.

## Codex Save

This repo now also contains `codex-save`, a separate operator-facing Cloudflare Pages site under [codex-save](/Users/andriilitvinov/projects/MYPROJECTS/links/codex-save) for:

- live diagnostics against `https://codex-links.pages.dev`
- remediation orchestration through the existing `codex-links` agent command API
- recheck and before/after reporting

Local commands:

```bash
npm run save:dev
npm run save:deploy
```

Notes:

- `codex-save` is a separate Pages project and needs its own KV namespace bound as `SAVE_STORE`
- remediation runs create real agent commands through `codex-links /api/commands`; they do not push directly to `main`

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
npx wrangler pages secret put ADMIN_TOKEN --project-name codex-links
npx wrangler pages secret put COMMAND_DISPATCH_MODE --project-name codex-links
```

Slack cloud secrets:

```bash
npx wrangler pages secret put SLACK_BOT_TOKEN --project-name codex-links
npx wrangler pages secret put SLACK_CODEX_DISPATCH_TOKEN --project-name codex-links
npx wrangler pages secret put SLACK_SIGNING_SECRET --project-name codex-links
npx wrangler pages secret put SLACK_CODEX_CHANNEL_ID --project-name codex-links
npx wrangler pages secret put SLACK_CODEX_USER_ID --project-name codex-links
```

Recommended values:

- `COMMAND_DISPATCH_MODE=cloud-via-slack`
- `COMMAND_DISPATCH_MODE=direct-openai` only when you explicitly want direct OpenAI as default
- `ADMIN_TOKEN` authorizes admin-only maintenance and Slack diagnostics; `LINKS_WRITE_TOKEN` remains accepted for existing bridge/write clients.
- `OPENAI_API_KEY` is optional and only needed for the direct OpenAI API route; the free/default `cloud-via-slack` route does not require it
- Slack variables are the default production route
- `SLACK_CODEX_DISPATCH_TOKEN` should be a Slack user token for the linked ChatGPT/Codex user. OpenAI Codex does not accept Codex tasks sent by the `Codex Links` bot actor, so the route uses this token for outgoing `@Codex` messages and photo uploads while keeping `SLACK_BOT_TOKEN` for reads/events.

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
- Cloud production delivery guardian: `npm run cloud:guardian`
- Bulk Pages secret upload from `.dev.vars`: `npm run cloud:install-secrets`
- KV-backed runtime config upload from `.dev.vars`: `npm run cloud:save-config`

If you do not want to manage Cloudflare Pages settings manually, `cloud:save-config` can store non-secret runtime settings in KV using only `LINKS_WRITE_TOKEN`. Keep `OPENAI_API_KEY` in the Pages environment; do not store it in KV.

## Local Secret Vault

Local wallet URL:

```bash
SECRET_VAULT_NO_OPEN=1 npm run secrets:local
```

The server prints `http://127.0.0.1:8789/secrets` and binds only to `127.0.0.1`. It saves selected values to macOS Keychain with `security add-generic-password`; it does not commit, print, or send secret values to GitHub, ChatGPT, Cloudflare, or Vercel.

If port `8789` is already occupied, use the stable YouTube setup port:

```bash
cd /Users/andriilitvinov/projects/MYPROJECTS/codex-links
SECRET_VAULT_PORT=8790 npm run secrets:local
```

Then open:

```text
http://127.0.0.1:8790/secrets
```

Shortcut for the same YouTube flow:

```bash
cd /Users/andriilitvinov/projects/MYPROJECTS/codex-links
npm run secrets:youtube
```

## How to add YouTube API key

1. Start the wallet:

   ```bash
   cd /Users/andriilitvinov/projects/MYPROJECTS/codex-links
   SECRET_VAULT_PORT=8790 npm run secrets:local
   ```

2. Open `http://127.0.0.1:8790/secrets`.
3. choose provider: YouTube Data API
4. paste key into Secret value
5. click Save
6. check: http://127.0.0.1:8790/api/secrets/status
7. expected: youtube_api_key_status should be configured

Metadata-only CLI check while the wallet is running:

```bash
cd /Users/andriilitvinov/projects/MYPROJECTS/codex-links
npm run secrets:youtube:status
```

Expected output shape:

```text
YouTube API key: configured
Channel handle: default
```

YouTube Data API provider:

- Provider label: `YouTube Data API`
- Required secret name: `YOUTUBE_API_KEY`
- Optional channel handle variable: `YOUTUBE_CHANNEL_HANDLE`
- Default channel handle: `@shamanic_academy`
- Keychain service: `youtube-data-api`
- Status endpoint: `GET /api/secrets/status` returns `youtube_api_key_status: configured|missing` and `youtube_channel_handle: configured|default`; it never returns the key value.

Paste the YouTube API key only into the local vault provider selector. Do not commit it, do not put it in docs, and do not expose it as `VITE_YOUTUBE_API_KEY` or any other frontend-bundled variable. The future YouTube inventory fetch should use this key only from server-side scripts/actions. In Google Cloud, restrict the key to YouTube Data API v3.

## How to add Reiki Supabase migration secrets

Start the wallet:

```bash
cd /Users/andriilitvinov/projects/MYPROJECTS/codex-links
SECRET_VAULT_PORT=8790 npm run secrets:local
```

Open:

```text
http://127.0.0.1:8790/secrets
```

Add both entries in the `Secret type` selector:

1. Choose `Reiki Yggdrasil / Supabase - SUPABASE_ACCESS_TOKEN`, paste into `Secret value`, then save.
2. Choose `Reiki Yggdrasil / Supabase - SUPABASE_PROJECT_REF`, paste into `Secret value`, then save.

Shortcut for the same Reiki Supabase flow:

```bash
cd /Users/andriilitvinov/projects/MYPROJECTS/codex-links
npm run secrets:reiki:supabase
```

Metadata-only status check while the wallet is running:

```bash
cd /Users/andriilitvinov/projects/MYPROJECTS/codex-links
npm run secrets:reiki:supabase:status
```

Expected output shape:

```text
SUPABASE_ACCESS_TOKEN: configured
SUPABASE_PROJECT_REF: configured
```

Reiki Supabase provider:

- Provider label: `Reiki Yggdrasil / Supabase`
- Required secret names: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`
- Keychain service: `reiki-yggdrasil-supabase`
- Status endpoint: `GET /api/secrets/status` returns only `configured|missing` metadata for `supabase_access_token_status` and `supabase_project_ref_status`.
- Local runner handoff: `POST /api/secrets/read` can return values only to local scripts that request project `Reiki Yggdrasil / Supabase`; never print the returned values.

Use these values only for local/server-side Codex and migration runner actions. Do not commit them, do not put them in docs, and do not expose either value as `VITE_*` or any other frontend-bundled variable.

## Slack Cloud Worker Ops

Operational contract for `cloud-via-slack`:

- `SLACK_CODEX_USER_ID` must point to the real Slack worker user, not the `Codex Links` app bot user returned by `auth.test`
- When `SLACK_CODEX_USER_ID` is set, dispatch mentions that exact user as `<@SLACK_CODEX_USER_ID>`; `SLACK_CODEX_MENTION` is only a fallback for legacy installs.
- For the Slack cloud route, install the separate [OpenAI Codex Slack app](https://slack.com/marketplace/A09F5C369E3-openai-codex) in the target workspace first. After installation, use that app's `@Codex` bot/user ID for `SLACK_CODEX_USER_ID`; do not use the `Codex Links` sender app ID.
- Set `SLACK_CODEX_DISPATCH_TOKEN` to a Slack user token for the human ChatGPT/Codex account linked to that workspace; bot-originated messages from `Codex Links` trigger the OpenAI Codex "connect your ChatGPT Codex account" prompt instead of starting work.
- Optional: set `SLACK_ACTOR_PROBE_COOLDOWN_MS=30000` to suppress repeated live actor probes during temporary Slack/Codex disconnects.
- the local launchd agents in this repo cover only `local-bridge` and `claude-bridge`
- `cloud:guardian` is the local Mac runner that verifies Cloud PR/merge/live site delivery and mirrors terminal reports into the Codex Desktop `Codex Links Cloud Reports` thread; install its 60s launchd schedule with `scripts/install-cloud-guardian-launch-agent.sh`
- the Slack/Codex cloud worker is external to this repo; if it stops replying, the route will dispatch to Slack and then fall back to bridge

Recovery checklist:

1. Run `node scripts/check-cloud-setup.mjs`
2. Confirm `/api/status` shows `dispatchMode=slack-codex-cloud`
3. Confirm `slackActor.validationStatus=validated` for the real worker user, not the app bot user
4. Run `node scripts/smoke-cloud-photo-delivery.mjs`
5. Treat the route as unhealthy unless final `actualExecutor=cloud-via-slack`

Local process management:

- local bridge: `~/Library/LaunchAgents/com.andriilitvinov.codex-links-bridge.plist`
- Claude bridge: `~/Library/LaunchAgents/com.andriilitvinov.codex-links-claude-bridge.plist`
- Cloud guardian: `~/Library/LaunchAgents/com.andriilitvinov.codex-links-cloud-guardian.plist`
- install or refresh launchd agents with `scripts/install-bridge-launch-agent.sh`, `scripts/install-claude-bridge-launch-agent.sh`, and `scripts/install-cloud-guardian-launch-agent.sh`

Useful log paths:

- `~/Library/Logs/codex-links-bridge.log`
- `~/Library/Logs/codex-links-bridge.error.log`
- `~/Library/Logs/codex-links-claude-bridge.launchd.log`
- `~/Library/Logs/codex-links-claude-bridge.launchd.error.log`
- `~/Library/Logs/codex-links-cloud-guardian.launchd.log`
- `~/Library/Logs/codex-links-cloud-guardian.launchd.error.log`

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

## Cloud Code GitHub Sync

Use this when changes are generated from Cloud Code and should be synced automatically to GitHub:

1. Set a repo-scoped GitHub token in the Cloud Code container:

```bash
export GITHUB_TOKEN=<your_repo_scoped_PAT>
```

2. Run the sync task:

```bash
npm run cloud:sync -- "chore: sync from Cloud Code"
```

What it does:

- Checks `origin` and updates from remote with `--autostash`
- Creates a branch `codex-links/auto-sync-YYYYMMDD-HHMMSS` if run on `main`
- Commits local changes and pushes the branch
- Suggests `gh pr create` for a PR

Notes:

- `403` means token is missing or lacks repository permission.
- Prefer `repo`-scoped PAT for `andylitvinov-design/codex-links`.

VS Code/Cloud Code shortcut:

- Use task `Cloud Sync (github)` in `.vscode/tasks.json` to run it interactively.

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
