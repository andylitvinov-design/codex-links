# STATE

- current goal: сделать `links` постоянной облачной точкой входа для работы с проектами с телефона и компьютера
- current task: finalize issue #160 with live OpenClaw Telegram gateway proof and basic bot menu/help
- next step: merge PR #164 after final checks and close issue #160 only if the PR/merge and live proofs are complete

## 2026-05-22 OpenClaw Telegram Finalization

- repo used: `/Users/andriilitvinov/projects/MYPROJECTS/codex-links`, branch `codex/local-secret-vault-160`, PR #164
- command visibility proof: `GET https://codex-links.pages.dev/api/commands?id=d9f46619-beab-4594-96bc-c33d6e5d7e02` returns `clientId=telegram:6108895831`; current status is `failed` because the local bridge guardrail skipped it for `min-interval-between-starts`, so Telegram gateway creation is proven and the failure is downstream bridge execution
- poller proof: an older LaunchAgent from `/Users/andriilitvinov/projects/MYPROJECTS/links` produced Telegram `409 Conflict`; it was booted out, leaving only `/Users/andriilitvinov/projects/MYPROJECTS/codex-links/scripts/openclaw-telegram-gateway.mjs` active
- live gateway status: `running=true`, `plistHasToken=false`, `tokenPresent=true`; token and write token are supplied via Keychain/launchd env, not plist or repo files
- bot menu status: `/start`, `/help`, `/status`, and `/codex` were verified through the real Telegram bot API; `/codex` created command `6790b188-0adb-42d2-b760-7ac9905ec2d6` with `clientId=telegram:6108895831`
- menu implementation: gateway handles `/start`, `/help`, `/status`, `/vault`, `/projects`, `/version`, and `/codex <task>`; Telegram `setMyCommands` returned HTTP 200; no token values are sent in bot replies
- safety status: Monobank remains store-only, no `.env` was committed, no token was put into plist, and `/api/commands` architecture was not rewritten

## 2026-05-21 Local Secret Vault

- repo used: `/Users/andriilitvinov/projects/MYPROJECTS/codex-links`, branch `codex/local-secret-vault-160`, synced to `origin/main` commit `993d9cd7ff25dc41b3d13068b928ed7131251a00`
- root cause proof before patching: the starting dirty branch was `codex/openclaw-telegram-gateway-160` at `15ee579a8e40283b06cc9dd68add99a33e90cd69` and lacked `scripts/local-secret-vault.mjs`, `tests/local-secret-vault.test.mjs`, `secrets:local`, and `setup:openclaw:telegram-token`; after fast-forwarding `main`, the starter vault files appeared
- safety preservation: the dirty starting state was saved in stash `safety: openclaw telegram gateway 160 dirty state before local secret vault` and branch `codex/safety-openclaw-telegram-160-20260521`
- vault status: local server binds to `127.0.0.1` only, opens `/secrets`, supports Telegram Bot Token, Codex Links Write Token, Monobank Token, and Custom Secret, and returns metadata-only/redacted JSON
- storage status: mocked tests prove Keychain write through `security add-generic-password -U`; no secret is returned in JSON, written to plist, or printed by tests
- Telegram apply status: mocked tests prove launchd seeding plus existing OpenClaw repair/status flow; local live repair still reports `token_source=missing`, `plistHasToken=false`, `running=false`, `pid=0`
- Monobank status: store-only; no import/sync command is run by the vault
- blocked before closing #160: real Telegram token is still absent from shell, launchd, and Keychain; allowed chat ID and Codex Links write token were also not present in shell or launchd during this run

## 2026-05-12 OpenClaw Readiness

- local status: installed, `openclaw` at `/Users/andriilitvinov/.npm-global/bin/openclaw`, version `OpenClaw 2026.4.26 (be8c246)`
- verification command: `bash scripts/check-openclaw.sh`
- integration status: readiness layer only; OpenClaw is not an active executor in production dispatch
- probe command: `npm run probe:openclaw`
- probe status: safe CLI command execution was verified with `openclaw status --json --timeout 2000`; gateway reachability remains false, with prior `timeout` and latest non-secret scope error evidence
- execution status: no safe no-op/dry-run/echo agent run command has been verified, so executor runs remain `needs verification`
- production dispatch: still not connected to OpenClaw; Slack-backed Codex Cloud, direct OpenAI opt-in, local bridge, and Claude bridge behavior are unchanged
- usage model: docs define OpenClaw as readiness/probe-only for local diagnostics, smoke checks, safe verification commands, future opt-in local executor mode, and later `brain-management` telemetry
- blocked before `executor=openclaw`: `gatewayReachable=true`, non-secret auth verification, safe no-op/sandbox execution, timeout contract, stdout/stderr/artifact contract, and stable telemetry contract
- next action: add an explicit `openclaw` local executor adapter only after auth, gateway health, no-op/sandboxed execution, artifact output, timeout handling, and telemetry are verified

## 2026-05-15 OpenClaw Feedback Loop

- feedback loop status: `npm run feedback:verify` added as a read-only live verifier for ChatGPT/Codex post-PR and post-deploy checks
- PR stack status: PR #152 and PR #153 have landed on `main`; PR #155 is now retargeted/rebased onto `main`
- supported project keys: `finance`, `reiki-yggdrasil`
- verified now: finance `/api/status` commit comparison plus bounded `/api/audit-snapshot` summary; Reiki route reachability for `/`, `/profile`, `/masters`, and `/profile/admin`
- finance current live note: `/api/status` is HTTP 200 with parseable JSON and commit `8a11322db98d7027e482dc08cb10a9a381536e95`; `/api/audit-snapshot` is HTTP 200 but JSON parse false, so only safe bounded diagnostics should be recorded
- blocked: Reiki still needs a public `/version.json` or `/api/status` endpoint before commit/version proof can pass; OpenClaw gateway/run support remains `needs verification` with `gatewayReachable=false`, latest `gatewayError=missing scope: operator.read`, and `run_supported=false`
- delivery timeline status: compact `deliveryFeedback` persistence is wired through authorized command delivery updates with only `result`, `observedCommit`, `versionVerification`, `exactFailingCommand`, and `nextAction`
- production dispatch: unchanged; OpenClaw is still not wired into production dispatch, Cloudflare routing, Slack delivery, reports APIs, or deployment config
- next action: add public version/status endpoints to projects that need provable live commit checks, then run live deploy/status verification only when deploy verification is in scope
