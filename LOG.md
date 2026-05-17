# LOG

## 2026-05-12

- Audited Codex onboarding and memory files for token-efficient future sessions.
- Added `CODEX_BRIEF.md` as the short first-read project memory file.
- Hardened `AGENTS.md` with ordered first reads, narrow delivery-path file list, repo/live/Slack/env boundaries, and final report requirements.
- Expanded `STATE.md` with current operating state, live/repo boundary, and a known version-reference risk.
- No delivery code, Cloudflare contract, Slack linkage, secrets, UI behavior, or `codex-save` behavior changed.

## 2026-05-15

- Added the first read-only OpenClaw feedback-loop verifier: `npm run feedback:verify`.
- Documented supported live checks for `finance` and `reiki-yggdrasil`, plus future non-secret telemetry event names.
- Restored OpenClaw readiness/probe scripts into this checkout so `npm run check:openclaw` and `npm run probe:openclaw` are available.
- Verification: OpenClaw readiness passed, safe probe completed with `run_supported=false`, finance live verification reached `/api/status` and `/api/audit-snapshot`, and reiki live verification failed on expected route checks returning `404`.
- No deploy, merge, production mutation, secrets read, command dispatch rewrite, or OpenClaw executor activation was done.

## 2026-05-16

- Added safe OpenClaw Telegram setup and doctor commands: `npm run setup:openclaw:telegram` and `npm run doctor:openclaw:telegram`.
- Proved the failing layer: Cloudflare Pages lists encrypted `TELEGRAM_BOT_TOKEN`, but the local OpenClaw daemon environment does not expose it and the local gateway still reports `gatewayReachable=false`.
- Removed the local OpenClaw Telegram wildcard group entry and documented pairing-only DM plus allowlist group posture.
- Added tests for Telegram doctor parsing, policy checks, wildcard rejection, and the Pages-vs-local-env diagnosis.
- No production dispatch path, wildcard public access, secret values, deploy, or OpenClaw executor activation was added.

## 2026-05-17

- Reproduced the outside-root npm failure: running `npm run setup:openclaw:telegram -- --dry-run` from `/Users/andriilitvinov` makes npm look for `/Users/andriilitvinov/package.json`.
- Added `scripts/openclaw-telegram-anywhere.mjs` and `npm run setup:openclaw:telegram:anywhere` so Telegram setup can locate the local `codex-links` checkout, cd into it, and run setup plus doctor from any shell directory.
- Added a regression test for checkout discovery from outside the repo root.
- Reconciled PR #150 source of truth: the launchd/gateway files existed only as local untracked files, while GitHub PR head `a4578b7c4cd9caa4797514223f9a4afe93c3a292` did not contain them.
- Added `scripts/openclaw-telegram-gateway.mjs`, `scripts/openclaw-telegram-launchd.mjs`, gateway lifecycle npm scripts, LaunchAgent/doctor integration, and focused tests without committing `.env` or Cloudflare secret changes.
