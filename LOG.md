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
