# Codex Links

Cloudflare Pages inbox for links and Codex tasks, with production execution routed through Codex Cloud via Slack.

## Current Architecture

- Public UI and API: Cloudflare Pages
- Production executor: `Codex Cloud via Slack`
- Fallback executor: local bridge on Mac
- Source repo for Codex Cloud: `andylitvinov-design/codex-links`

This repo no longer treats the local Mac bridge as the primary execution path. If Slack + Codex Cloud are configured, tasks are dispatched from `POST /api/commands` directly into Slack, where `@Codex` can run them in the cloud and reply back into the app.

## What The App Does

- Stores links in Cloudflare KV
- Accepts commands from the mobile UI through `POST /api/commands`
- Dispatches commands to Slack for Codex Cloud execution
- Ingests Slack thread replies through `/api/slack`
- Mirrors assistant replies and PR links back into the mobile timeline

## Command Lifecycle

Production statuses:

- `queued`
- `dispatched`
- `processing`
- `answered`
- `failed`

Legacy status:

- `acked`

The UI still renders old `acked` records, but new cloud-executed tasks should move through the cloud-native lifecycle above.

## Required Secrets

Set these in Cloudflare Pages for project `codex-links`:

```bash
npx wrangler pages secret put LINKS_WRITE_TOKEN --project-name codex-links
npx wrangler pages secret put SLACK_BOT_TOKEN --project-name codex-links
npx wrangler pages secret put SLACK_SIGNING_SECRET --project-name codex-links
npx wrangler pages secret put SLACK_CODEX_CHANNEL_ID --project-name codex-links
npx wrangler pages secret put SLACK_CODEX_USER_ID --project-name codex-links
npx wrangler pages secret put COMMAND_DISPATCH_MODE --project-name codex-links
```

Recommended values:

- `COMMAND_DISPATCH_MODE=slack-codex-cloud`
- `SLACK_CODEX_MENTION=@Codex` if you prefer name-based mention text
- `SLACK_CODEX_USER_ID=<slack-user-id>` for reliable `<@user>` mention formatting

## Slack + Codex Cloud Setup

1. Connect GitHub repo `andylitvinov-design/codex-links` inside Codex Cloud at `chatgpt.com/codex`.
2. Create or select a Codex environment that can open branches and PRs.
3. Install and enable the Codex Slack integration for the workspace.
4. Create one dedicated private Slack channel for Codex Links tasks.
5. Put that channel id into `SLACK_CODEX_CHANNEL_ID`.
6. Configure Slack Events to call:

```text
https://codex-links.pages.dev/api/slack
```

Subscribe to message events for the dedicated channel so Codex replies are mirrored back into the app.

Quick helpers added to this repo:

- Slack app manifest: [integrations/slack/codex-links-app-manifest.yml](/Users/andriilitvinov/projects/MYPROJECTS/links/integrations/slack/codex-links-app-manifest.yml)
- Local/prod setup check: `npm run cloud:check`
- Bulk Pages secret upload from `.dev.vars`: `npm run cloud:install-secrets`
- KV-backed runtime config upload from `.dev.vars`: `npm run cloud:save-config`

If you do not want to manage Cloudflare Pages secrets manually, `cloud:save-config` can store the Slack/Codex Cloud settings in KV using only `LINKS_WRITE_TOKEN`. This is easier to operate, but less strict than using platform secrets.

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

The handler verifies Slack signatures, maps thread replies back to the originating command, stores assistant messages in KV, and updates command status and PR metadata.

## Notes

- Photo-only cloud requests are intentionally blocked in v1. Text commands are the first-class path for Slack-triggered Codex Cloud execution.
- The local bridge scripts remain in the repo as manual fallback tooling, but they are no longer the primary production architecture.
