# LOG

## 2026-05-16

- Added explicit approved-proposal dispatch endpoint: `POST /api/proposals/:proposalId/dispatch`.
- Dispatch requires existing write/admin authorization, requires `status=approved`, is duplicate-safe for already linked proposals, and stores `status=dispatched`, `dispatchedAt`, `commandId`, optional `codexRunId`, optional `deliveryId`, `dispatchEnabled=true`, and `updatedAt`.
- Approval remains separate from dispatch: `POST /api/proposals/:proposalId/approve` still only changes proposal state and does not auto-create a command.
- Dispatch connects approved proposals to the existing Codex command path and does not make OpenClaw the production/default executor.
- Next action: normalize Codex results back into proposal records and add a small inbox/timeline UI for the proposal/result thread.

## 2026-05-15

- Added safe ChatGPT/OpenClaw/Codex proposal storage API: `POST /api/proposals`, `GET /api/proposals?threadKey=...`, `GET /api/proposals/:proposalId`, and `POST /api/proposals/:proposalId/approve`.
- Proposal approval is storage-only: it sets `status=approved`, `approvedAt`, optional `approvedBy`, and keeps `codexRunId=null`, `deliveryId=null`, `dryRun=true`, and `dispatchEnabled=false`.
- Kept dispatch disconnected: no Codex command creation, OpenClaw run, Slack dispatch, Cloudflare deploy, merge, delete, secrets/env reads, or production executor default changes.
- Added proposal API/storage tests and documented the create/list/read/approve flow in `docs/chatgpt-openclaw-codex-loop.md`.
- UI remains the next layer; this PR intentionally stops at API/docs/storage.

- Added `docs/chatgpt-openclaw-codex-loop.md` and `docs/examples/chatgpt-openclaw-codex-loop.example.json` for the ChatGPT/OpenClaw/Codex approval-loop contract.
- Added `npm run loop:proposal` as a dry-run-only proposal generator with JSON and compact key/value output; it does not dispatch to Codex, OpenClaw, Slack, Cloudflare, or production services.
- Added tests for proposal generation, required approval guardrails, missing repo/prompt verification notes, status validation, and compact output.
- Updated `STATE.md` to mark direct same-ChatGPT-thread callback as `needs verification`, keep Codex Links inbox/timeline as the bridge surface, and keep production dispatch unchanged.
- Added `npm run feedback:verify` as a read-only OpenClaw/ChatGPT feedback verifier for `finance` and `reiki-yggdrasil`.
- Added compact JSON/key-value output with exact failing check reporting, bounded GET-only live checks, finance commit comparison, finance audit snapshot summary, and Reiki route reachability checks.
- Documented the feedback-loop contract in `docs/openclaw-feedback-loop.md` and kept OpenClaw out of production dispatch, Cloudflare routing, Slack delivery, reports APIs, deployment config, and secrets/env handling.
- Review update: PR #153 is still open, so PR #155 remains stacked on `codex/openclaw-probe` and was not retargeted.
- Hardened finance `/api/audit-snapshot` parse-false diagnostics to report only status, content type, body length, parse error type, and a short safe snippet when no secret-like text is detected.
- Latest verification: OpenClaw check passed; probe still reports `gatewayReachable=false`, latest `gatewayError=missing scope: operator.read`, and `run_supported=false`; finance `/api/status` returned HTTP 200 JSON with live commit `8a11322db98d7027e482dc08cb10a9a381536e95`; finance `/api/audit-snapshot` returned HTTP 200 with JSON parse false; Reiki routes were reachable but `/profile`, `/masters`, and `/profile/admin` returned 404 and version proof remains `needs_verification`.

## 2026-05-14

- Added the practical OpenClaw usage model to `docs/openclaw-integration.md`.
- Kept OpenClaw readiness/probe-only: no production dispatch, Cloudflare routing, Slack delivery, reports/delivery API, or secret/env handling changes.
- Documented required gates before `executor=openclaw`: gateway reachability, non-secret auth verification, safe no-op/sandbox execution, timeout behavior, stdout/stderr/artifact contract, and stable telemetry.
- Verification: `npm run check:openclaw`, `npm run probe:openclaw`, and `git diff --check` passed; `npm test` still has an unrelated bridge-launch-config assertion failure in `scripts/bridge-codex-commands.mjs`.
