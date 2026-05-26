# LOG

## 2026-05-26

- Added `Reiki Yggdrasil / Supabase` as a Local Secret Vault section with store-only entries for `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` under Keychain service `reiki-yggdrasil-supabase`.
- Added metadata-only Reiki Supabase status through `/api/secrets/status`, plus `npm run secrets:reiki:supabase` and `npm run secrets:reiki:supabase:status`.
- Added a delete action to the Local Secret Vault UI/API so stored secrets can be updated, replaced, or deleted without printing values.
- Updated README/STATE documentation with the exact local wallet URL, paste flow, secret names, and the rule that migration secrets must stay out of frontend-bundled variables.

- Identified `scripts/local-secret-vault.mjs` as the existing wallet implementation for project API keys. It is local-only, binds to `127.0.0.1`, and writes to macOS Keychain without returning secret values.
- Added `YouTube Data API` as a store-only provider for `YOUTUBE_API_KEY`, with `YOUTUBE_CHANNEL_HANDLE` documented as an optional/default variable using `@shamanic_academy`.
- Added non-secret YouTube status metadata through `/api/secrets/catalog` and `/api/secrets/status`: configured/missing for the key and configured/default for the channel handle.
- Added `npm run secrets:youtube` for the stable `8790` setup flow and `npm run secrets:youtube:status` for metadata-only local status output.
- Updated README/STATE documentation with the exact `8790` command, URL, paste location, variable names, and the rule that the key must not be committed or exposed as `VITE_*`.

## 2026-05-22

- Proved the failing layer before patching: live command `d9f46619-beab-4594-96bc-c33d6e5d7e02` is visible from `GET /api/commands`, has `clientId=telegram:6108895831`, and failed after creation because the local bridge guardrail skipped it for `min-interval-between-starts`.
- Proved the Telegram poller conflict layer: logs showed Telegram `409 Conflict` from duplicate `getUpdates`; `pgrep` found the canonical `/MYPROJECTS/codex-links` gateway plus an older `/MYPROJECTS/links` gateway. Booted out the older LaunchAgent and confirmed only the canonical gateway remained active.
- Restarted the canonical gateway from `/Users/andriilitvinov/projects/MYPROJECTS/codex-links`; status is running with `plistHasToken=false`, `tokenPresent=true`, and bot command registration returned HTTP 200 without storing token values in plist or repo files.
- Added basic Telegram menu/help handling in `scripts/openclaw-telegram-gateway.mjs`: `/start`, `/help`, `/status`, `/vault`, `/projects`, `/version`, and `/codex <task>`. Sensitive commands stay allowlisted; `/start` and `/help` remain safe public onboarding replies.
- Live Telegram proof through the real bot API: `/start` returned welcome, `/help` returned command list, `/status` returned gateway status, and `/codex` created command `6790b188-0adb-42d2-b760-7ac9905ec2d6` with `clientId=telegram:6108895831`.
- Verification: `node --check scripts/openclaw-telegram-gateway.mjs`, `node --test tests/openclaw-telegram-gateway.test.mjs`, `node --check scripts/local-secret-vault.mjs`, `node --test tests/local-secret-vault.test.mjs`, and `git diff --check` passed.

## 2026-05-21

- Worked in `/Users/andriilitvinov/projects/MYPROJECTS/codex-links`, remote `andylitvinov-design/codex-links`; saved the dirty starting branch state before syncing `main`.
- Proved the first failing layer before patching: the starting local branch lacked the Local Secret Vault files and scripts; `node --check scripts/local-secret-vault.mjs` failed with `MODULE_NOT_FOUND` and `node --test tests/local-secret-vault.test.mjs` failed because the file was missing.
- Fast-forwarded local `main` to `origin/main` `993d9cd7ff25dc41b3d13068b928ed7131251a00`, created `codex/local-secret-vault-160`, and restored the Telegram gateway adapter/test from the safety stash.
- Finished Local Secret Vault: `--secret telegram_bot_token` preselects Telegram in the UI, command execution is injectable for tests, Telegram apply returns parsed redacted status fields, and Monobank remains store-only.
- Added focused tests for UI preselect, mocked Keychain write, mocked Telegram apply repair/status flow, redacted responses, and Monobank no-import behavior.
- Runtime vault proof: `SECRET_VAULT_NO_OPEN=1 npm run secrets:local` printed `http://127.0.0.1:8789/secrets`; `lsof` showed `TCP 127.0.0.1:8789 (LISTEN)`; Playwright loaded the `/secrets` page title `Local Secret Vault`.
- Local gateway status remains blocked by missing secret/config material: `plistHasToken=false`, `running=false`, `pid=0`, `tokenPresent=false`; shell and launchd checks found no Telegram token, no allowed chat IDs, and no Codex Links write token.
- Verification: `node --check scripts/local-secret-vault.mjs`, `node --test tests/local-secret-vault.test.mjs`, both OpenClaw Telegram syntax checks, and focused OpenClaw Telegram tests passed. Full `npm test` still has two unrelated baseline failures in `tests/bridge-launch-config.test.mjs` and `tests/openclaw-verify-api.test.mjs`. Live Telegram `/status` and `/codex` were not verified because token/chat/write-token config is absent.

## 2026-05-16

- Merged PR #152 into `main`, retargeted and merged PR #153 into `main`, then retargeted and rebased PR #155 onto `main`.
- Added compact delivery timeline feedback persistence for OpenClaw/ChatGPT deploy verification results.
- Stored only `result`, `observedCommit`, `versionVerification`, `exactFailingCommand`, and `nextAction`; full audit snapshots and response bodies remain out of command storage.
- Kept OpenClaw readiness/probe-only: no `executor=openclaw`, no default dispatch change, no Slack delivery change, no Cloudflare routing change, no reports API change, and no secrets/env values touched.

## 2026-05-15

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
