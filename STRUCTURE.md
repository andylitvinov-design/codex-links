# Project Structure

## Key Files

```text
AGENTS.md - repo-specific operating rules for Codex Links work.
README.md - architecture, operations, secrets, and recovery notes.
STATE.md - current project status and next operational steps.
ROLLBACK.md - rollback procedure for production-facing changes.
wrangler.jsonc - Cloudflare Pages project name, output dir, and KV binding.
package.json - npm scripts for tests, Pages dev/deploy, smoke checks, and maintenance.
public/index.html - main mobile UI shell and cache-busted asset references.
public/app.js - browser-side command, status, delivery, project, and message UI logic.
public/styles.css - shared UI styles for the Pages frontend.
public/version.json - current static build marker used by the frontend.
public/_lib/ - small browser-side helpers for command errors, photo prep, and report UI.
functions/api/commands.js - `/api/commands` HTTP handler and command dispatch orchestration.
functions/api/status.js - `/api/status` bridge and route health endpoint.
functions/api/delivery.js - `/api/delivery` active delivery timeline endpoint.
functions/api/admin/commands-maintenance.js - authorized maintenance runner for stale commands.
functions/_lib/commands.js - KV-backed command records, queues, claims, fallbacks, and maintenance.
functions/_lib/timeouts.js - shared command timeout, wait, poll, and budget constants.
functions/_lib/prompt-builder.js - Slack-backed Codex Cloud command prompt builder.
functions/_lib/slack.js - Slack API integration, actor validation, reply parsing, and dispatch.
functions/_lib/project-dispatch-manifest.js - project-to-repository routing manifest.
functions/_lib/delivery.js - visible delivery stage and latency derivation helpers.
functions/_lib/status.js - bridge status persistence and derived health state.
functions/_lib/messages.js - KV-backed user/assistant message storage.
functions/_lib/config.js - runtime config loading from KV/env.
functions/_lib/security.js - request authorization and signature helpers.
scripts/bridge-codex-commands.mjs - local bridge loop that claims commands and runs Codex/Claude.
scripts/_lib/bridge-prompts.mjs - local bridge and photo retry prompt builders.
scripts/_lib/bridge-exec-timeouts.mjs - local Codex/Claude execution timeout selection.
scripts/run-links-bridge.sh - launch wrapper for the local bridge.
scripts/run-cloud-guardian.mjs - production delivery guardian for Slack/Codex Cloud tasks.
scripts/smoke-*.mjs - focused delivery smoke checks.
tests/*.test.mjs - Node test suite for routing, storage, dispatch, bridge, Slack, UI helpers, and ops scripts.
codex-save/ - separate operator-facing Pages app for diagnostics and remediation.
integrations/slack/codex-links-app-manifest.yml - Slack app manifest for the integration.
ops/deployment-manifest.json - deployment metadata for operational tracking.
```

## Data Flow

1. Phone browser loads `public/index.html`, `public/app.js`, and `public/styles.css` from Cloudflare Pages.
2. The UI submits a command to `POST /api/commands` on Cloudflare Pages Functions.
3. `functions/api/commands.js` normalizes the request, resolves project routing through `functions/_lib/project-dispatch-manifest.js`, stores command records in `LINKS_STORE` KV through `functions/_lib/commands.js`, and dispatches to the selected executor.
4. For local bridge work, `scripts/bridge-codex-commands.mjs` polls `POST /api/commands` with `action=claim`, claims a queued command from KV, prepares any photo payload, and runs Codex or Claude in the selected workspace.
5. The bridge writes progress, acknowledgements, assistant messages, failures, and final answers back through `/api/commands`, `/api/messages`, and `/api/status`; those endpoints persist updates in `LINKS_STORE` KV.
6. The phone UI polls `/api/delivery`, `/api/status`, `/api/messages`, and `/api/commands`, then renders the updated command state and assistant response.

## Timeout Constants

| Constant | Value | File |
| --- | ---: | --- |
| `RECENT_DUPLICATE_WINDOW_MS` | `5 * 60 * 1000` | `functions/_lib/timeouts.js` |
| `SUPERSEDED_DUPLICATE_WINDOW_MS` | `15 * 60 * 1000` | `functions/_lib/timeouts.js` |
| `CLOUD_FIRST_ACK_TIMEOUT_MS` | `15 * 1000` | `functions/_lib/timeouts.js` |
| `CLOUD_RESULT_TIMEOUT_MS` | `180 * 1000` | `functions/_lib/timeouts.js` |
| `SLACK_FIRST_ACK_TIMEOUT_MS` | `60 * 1000` | `functions/_lib/timeouts.js` |
| `SLACK_RESULT_TIMEOUT_MS` | `120 * 1000` | `functions/_lib/timeouts.js` |
| `SLACK_PHOTO_FIRST_ACK_TIMEOUT_MS` | `90 * 1000` | `functions/_lib/timeouts.js` |
| `SLACK_PHOTO_RESULT_TIMEOUT_MS` | `300 * 1000` | `functions/_lib/timeouts.js` |
| `SLACK_ACTOR_VALIDATION_RECOVERY_MS` | `15 * 1000` | `functions/_lib/timeouts.js` |
| `SLACK_DISPATCH_GRACE_MS` | `15_000` | `functions/_lib/timeouts.js` |
| `SLACK_SYNC_POLL_MS` | `2_000` | `functions/_lib/timeouts.js` |
| `READ_SLACK_SYNC_BUDGET_MS` | `2_500` | `functions/_lib/timeouts.js` |
| `READ_SPECIFIC_SLACK_SYNC_BUDGET_MS` | `8_000` | `functions/_lib/timeouts.js` |
| `READ_SLACK_API_TIMEOUT_MS` | `1_500` | `functions/_lib/timeouts.js` |
| `DEFAULT_KV_WRITE_RETRY_DELAY_MS` | `100` | `functions/_lib/timeouts.js` |
| `BRIDGE_CLAIM_TIMEOUT_MS` | `60 * 1000` | `functions/_lib/timeouts.js` |
| `BRIDGE_RESULT_TIMEOUT_MS` | `9 * 60 * 1000` | `functions/_lib/timeouts.js` |
| `BRIDGE_LONG_TEXT_RESULT_TIMEOUT_MS` | `9 * 60 * 1000` | `functions/_lib/timeouts.js` |
| `BRIDGE_PHOTO_CLAIM_TIMEOUT_MS` | `5 * 60 * 1000` | `functions/_lib/timeouts.js` |
| `BRIDGE_PHOTO_RETRY_WINDOW_MS` | `30 * 60 * 1000` | `functions/_lib/timeouts.js` |
| `CLAUDE_CLAIM_TIMEOUT_MS` | `60 * 1000` | `functions/_lib/timeouts.js` |
| `CLAUDE_RESULT_TIMEOUT_MS` | `9 * 60 * 1000` | `functions/_lib/timeouts.js` |
| `CLAUDE_LONG_TEXT_RESULT_TIMEOUT_MS` | `9 * 60 * 1000` | `functions/_lib/timeouts.js` |
| `CLAUDE_RETRY_WINDOW_MS` | `10 * 60 * 1000` | `functions/_lib/timeouts.js` |
| `BRIDGE_EXEC_TIMEOUT_MS` | `3 * 60 * 1000` | `scripts/_lib/bridge-exec-timeouts.mjs` |
| `BRIDGE_LONG_TEXT_EXEC_TIMEOUT_MS` | `8 * 60 * 1000` | `scripts/_lib/bridge-exec-timeouts.mjs` |
| `BRIDGE_PHOTO_EXEC_TIMEOUT_MS` | `20 * 60 * 1000` | `scripts/_lib/bridge-exec-timeouts.mjs` |
| `CLAIM_LEASE_MS` | `5 * 60 * 1000` | `scripts/bridge-codex-commands.mjs` |
| `READ_TIMEOUT_MS` | `15 * 1000` | `scripts/bridge-codex-commands.mjs` |
| `WRITE_TIMEOUT_MS` | `60 * 1000` | `scripts/bridge-codex-commands.mjs` |
| `SNAPSHOT_TIMEOUT_MS` | `12 * 1000` | `scripts/bridge-codex-commands.mjs` |
| `BRIDGE_RUN_TIMEOUT_MS` | `6 * 60 * 60 * 1000` | `scripts/bridge-codex-commands.mjs` |
| `LEASE_EXTENSION_MS` | `5 * 60 * 1000` | `scripts/bridge-codex-commands.mjs` |
| `TURN_PROGRESS_HEARTBEAT_MS` | `15 * 1000` | `scripts/bridge-codex-commands.mjs` |
| `BRIDGE_STATUS_HEARTBEAT_MS` | `30 * 1000` | `scripts/bridge-codex-commands.mjs` |
| `MAINTENANCE_INTERVAL_MS` | `60 * 1000` | `scripts/bridge-codex-commands.mjs` |
| `IDLE_DRAIN_WINDOW_MS` | `15 * 60 * 1000` | `scripts/bridge-codex-commands.mjs` |
| `IDLE_DRAIN_POLL_MS` | `1500` | `scripts/bridge-codex-commands.mjs` |
| `PHOTO_PREP_TIMEOUT_MS` | `60 * 1000` | `scripts/bridge-codex-commands.mjs` |
| `FETCH_RETRY_DELAY_MS` | `1200` | `scripts/bridge-codex-commands.mjs` |
| `OCR_TIMEOUT_MS` | `20 * 1000` | `scripts/bridge-codex-commands.mjs` |
| `TURN_READ_POLL_MS` | `1200` | `scripts/bridge-codex-commands.mjs` |
| `CLAIM_RETRY_DELAY_MS` | `350` | `scripts/bridge-codex-commands.mjs` |

## Todo/Fixme

None found in source files during this cleanup.
