# STATE

- current goal: сделать `links` постоянной облачной точкой входа для работы с проектами с телефона и компьютера
- current task: держать Slack-backed cloud как default executor, direct OpenAI как опциональный путь, и не оставлять bridge-команды в вечном `waiting-for-codex`
- next step: прогнать production smoke для `cloud-via-slack` и bridge, затем отдельно проверить opt-in `direct-openai`

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
- PR stack status: PR #155 remains stacked on PR #153 and must not be retargeted to `main` until #153 lands
- supported project keys: `finance`, `reiki-yggdrasil`
- verified now: finance `/api/status` commit comparison plus bounded `/api/audit-snapshot` summary; Reiki route reachability for `/`, `/profile`, `/masters`, and `/profile/admin`
- finance current live note: `/api/status` is HTTP 200 with parseable JSON and commit `8a11322db98d7027e482dc08cb10a9a381536e95`; `/api/audit-snapshot` is HTTP 200 but JSON parse false, so only safe bounded diagnostics should be recorded
- blocked: Reiki still needs a public `/version.json` or `/api/status` endpoint before commit/version proof can pass; OpenClaw gateway/run support remains `needs verification` with `gatewayReachable=false`, latest `gatewayError=missing scope: operator.read`, and `run_supported=false`
- production dispatch: unchanged; OpenClaw is still not wired into production dispatch, Cloudflare routing, Slack delivery, reports APIs, or deployment config
- next action: add public version/status endpoints to projects that need provable live commit checks, then optionally feed verifier output into the delivery timeline

## 2026-05-15 ChatGPT/OpenClaw/Codex Approval Loop

- approval loop status: docs + dry-run proposal prototype + safe proposal storage/approval API
- proposal storage: API records are stored under stable `threadKey` with `dryRun=true` and `dispatchEnabled=false`
- approval status: `POST /api/proposals/:proposalId/approve` changes only stored status from `proposed` to `approved`
- direct same-ChatGPT-thread callback: needs verification; do not claim this is available until an official callback surface is proven
- bridge surface: Codex Links inbox/timeline under a stable `threadKey`
- supported example project keys: `finance`, `reiki-yggdrasil`
- production dispatch: unchanged; approved proposals are not connected to Codex commands, OpenClaw, Slack delivery, Cloudflare routing, merge, or deploy
- UI status: not connected yet; API/docs are the safe layer for this PR
- next action: connect approved proposal records to the existing Codex command path in a future PR, with dispatch still explicit and bounded
