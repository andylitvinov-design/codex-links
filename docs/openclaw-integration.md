# OpenClaw Integration Readiness

## Purpose

OpenClaw is a local executor candidate for Codex Links. In this system it is intended to help ChatGPT/Codex workflows run local, auditable execution steps from the operator machine after Codex has explicitly selected a safe project and repo context.

This document is a readiness contract only. It does not make OpenClaw an active production executor.

## Current Status

- status: installed
- binary: `openclaw`
- path: `/Users/andriilitvinov/.npm-global/bin/openclaw`
- version: `OpenClaw 2026.4.26 (be8c246)`
- verified smoke command: `bash scripts/check-openclaw.sh`
- verified probe command: `npm run probe:openclaw`
- Telegram setup command: `npm run setup:openclaw:telegram`
- Telegram doctor command: `npm run doctor:openclaw:telegram`

Runtime integration details are still `needs verification`. This readiness layer verifies the local binary, `--version` response, `--help` command list, and a safe read-only `openclaw status --json --timeout 2000` probe. It does not verify OpenClaw auth, model provider login, artifact output, or agent command execution.

Telegram is configured only through a local environment reference named `TELEGRAM_BOT_TOKEN`. The Cloudflare Pages secret with the same name proves production configuration for `codex-links`, but it does not populate the local OpenClaw daemon environment. The doctor reports those two layers separately and prints booleans only, never token values.

## Practical Usage Model

OpenClaw is useful now as a local operator-side verification tool, not as a production dispatcher.

Useful current and future roles:

- local diagnostics for the operator machine and project worktrees
- local smoke checks before handing work back to Codex Links
- CLI and tool availability checks such as `openclaw --version`, `openclaw --help`, `openclaw health`, `openclaw doctor`, `openclaw status`, and `openclaw config validate`
- project verification commands that are read-only or explicitly safe, such as package scripts that check config, run tests, or inspect status without deploying or rewriting tracked files
- future local executor mode after gateway, auth, no-op execution, artifacts, timeout, and telemetry contracts are proven
- future `brain-management` telemetry after Codex Links emits stable non-secret OpenClaw events

OpenClaw must not be used yet for:

- production dispatch default or automatic fallback
- secret, token, cookie, local env, or credential inspection
- destructive commands, file deletion, reset commands, migrations, or broad rewrites
- external publishing, Cloudflare deploys, Slack delivery, report publishing, or production API mutation
- financial, account, payment, or provider-side changes
- broad repo rewrites or architecture changes outside an explicit PR scope

Safe first use cases:

- `npm run check:openclaw`
- `npm run probe:openclaw`
- `npm run setup:openclaw:telegram -- --dry-run`
- `npm run doctor:openclaw:telegram`
- `npm run feedback:verify -- --project finance --json`
- `npm run feedback:verify -- --project reiki-yggdrasil --json`
- `openclaw health`
- `openclaw doctor`
- `openclaw status`
- `openclaw config validate`
- local project verification commands in read-only or explicitly safe mode

Current blockers:

- `gatewayReachable=false`
- `gatewayError=timeout` was the original blocker; the latest verification can also report non-secret gateway/auth scope errors while reachability remains false
- `run_supported=false`
- no safe no-op, dry-run, sandbox, or echo agent run has been verified
- local Telegram activation still requires `TELEGRAM_BOT_TOKEN` in the local OpenClaw daemon environment; Cloudflare Pages has its own encrypted secret store

## Verification Before Use

Codex should verify OpenClaw before relying on it:

```bash
npm run check:openclaw
```

The script checks these binary names in order:

- `openclaw`
- `open-claw`
- `claw`

The check prints only status, binary name, path, version if available, and the smoke command. It must not print environment values, tokens, cookies, keys, or local secret files.

## Safe CLI Probe

Run the repeatable probe with:

```bash
npm run probe:openclaw
```

The probe script:

- locates the binary with `command -v openclaw`
- reads the version with `openclaw --version`
- discovers safe CLI support from `openclaw --help`
- runs only `openclaw status --json --timeout 2000` when `status` is present
- applies an external 20 second guard around the status probe
- prints a short key/value summary with `status`, `binary`, `version`, `command_supported`, `run_supported`, `stdout_summary`, `stderr_summary`, `duration_ms`, and `needs_verification`
- truncates stdout and stderr summaries
- does not read `.env` files, print environment values, dispatch messages, call production APIs, or modify repo files

## Safe Telegram Setup

Run the non-mutating validation first:

```bash
npm run setup:openclaw:telegram -- --dry-run
npm run doctor:openclaw:telegram
```

The setup command enforces this safe OpenClaw Telegram posture:

- `channels.telegram.botToken` is an env secret reference to `TELEGRAM_BOT_TOKEN` when the local environment can resolve it
- `channels.telegram.dmPolicy=pairing`
- `channels.telegram.groupPolicy=allowlist`
- `channels.telegram.groups={}`
- `channels.telegram.enabled=false` unless `--enable` is passed and `TELEGRAM_BOT_TOKEN` is present locally

This deliberately avoids wildcard public access. The doctor fails if `channels.telegram.groups` contains `"*"`, if DM policy is not pairing, if group policy is not allowlist, or if the token is not an env reference.

After the local daemon environment has `TELEGRAM_BOT_TOKEN`, activate Telegram explicitly:

```bash
npm run setup:openclaw:telegram -- --enable
npm run doctor:openclaw:telegram
```

Do not paste or print the token. Cloudflare Pages can confirm only that the encrypted secret name exists; it cannot export that value back into the local daemon.

Observed CLI capabilities in this pass:

- `openclaw --help` is available and lists `status`, `health`, `doctor`, `config validate`, `agent`, `tasks`, gateway commands, and other subcommands.
- `openclaw status --json --timeout 2000` is a safe read-only command and completed locally.
- The local gateway service is installed and running, but `status` reported gateway reachability as `false` with `error: timeout` during this probe.
- No documented safe no-op, dry-run, or echo-style agent run command was identified from top-level help.

Therefore `run_supported` remains `false` and `needs_verification` remains `true` until a follow-up PR proves an explicit no-op or sandboxed local agent execution contract.

## Safe Feedback Loop

The first feedback loop is read-only and lives outside production dispatch:

```bash
npm run feedback:verify -- --project finance --json
npm run feedback:verify -- --project finance --expected-commit <sha> --json
npm run feedback:verify -- --project reiki-yggdrasil --json
```

This verifier checks only public live URLs and prints compact non-secret summaries. It never deploys, merges, mutates production, reads env files, sends Slack messages, or makes OpenClaw the default executor.

Supported projects:

- `finance`: defaults to [https://ezohata-incoming-ledger.vercel.app](https://ezohata-incoming-ledger.vercel.app), checks `/api/status` and `/api/audit-snapshot`, and compares `--expected-commit` against `commitSha` when provided.
- `reiki-yggdrasil`: defaults to [https://reiki-yggdrasil.vercel.app](https://reiki-yggdrasil.vercel.app), checks `/`, `/profile`, `/masters`, and `/profile/admin`, and reports `observedCommit=needs_verification` until that repo exposes a public `/version.json` or status endpoint.

The verifier result can be `pass`, `fail`, or `needs_verification`. A `pass` for commit verification requires an expected commit and a matching observed live commit. Without a public version endpoint or without an expected commit, reachable live checks can still return `needs_verification`.

## Future Local Executor Contract

OpenClaw may later connect to Codex Links as a local executor mode after a separate implementation and verification pass.

Minimal future command contract:

- `executor`: `openclaw`
- `input`: command text, `projectKey`, repo path, and approved check id
- `output`: status, duration, stdout summary, stderr summary, artifact metadata, and non-secret error summary
- telemetry event: `openclaw_check` first; `openclaw_run` only after no-op execution is proven
- telemetry fields: success or failure, duration, binary name, version, project key, check id, and non-secret error summary

All command execution, auth, daemon, gateway, artifact handling, and timeout behavior remains `needs verification`.

The current local adapter boundary is a contract only. OpenClaw is not an active production executor yet, and production dispatch behavior is unchanged.

## Integration Model

The intended integration flow is:

1. Codex Links receives a command through the existing command lifecycle.
2. `projectKey` maps to the selected repo and project memory context.
3. OpenClaw is allowed to run only approved local checks for that project.
4. The local result returns as non-secret summaries and artifact metadata.
5. Codex Links displays the result in the delivery timeline.
6. `brain-management` consumes telemetry later, after event names and fields are stable.

This flow is not implemented yet. It is the target contract for a future opt-in executor PR.

## Required Gates Before `executor=openclaw`

Do not enable an OpenClaw executor route until all of these are true:

- `gatewayReachable=true`
- auth state is verified without exposing secrets
- a safe no-op or sandbox command is verified
- timeout behavior is documented for gateway checks and agent runs
- stdout, stderr, and artifact metadata contract is documented
- telemetry event contract is stable and non-secret
- production default remains Slack-backed Codex Cloud unless a later explicit release changes it

## Must Not Replace Yet

OpenClaw must not replace these paths until an explicit follow-up PR proves the new executor end to end:

- Slack-backed Codex Cloud command path
- existing Cloudflare Pages command lifecycle
- existing reports and delivery APIs
- local bridge or Claude bridge launchd operations
- direct OpenAI opt-in route

## Brain Management Telemetry

No `brain-management` telemetry is changed in this readiness PR. The next safe step is to add OpenClaw readiness metrics there only after Codex Links emits `openclaw_check` or `openclaw_run` events with a stable non-secret contract.

## Recommended Rollout

1. Phase 1 readiness: keep binary, version, help, and config checks only.
2. Phase 2 probe: keep the bounded `openclaw status --json --timeout 2000` probe and report `needs_verification` while gateway or run support is blocked.
3. Phase 3 feedback loop: verify public live URLs and optional expected commits without any production mutation.
4. Phase 4 gateway fix: resolve the gateway timeout and prove `gatewayReachable=true`.
5. Phase 5 local no-op execution: prove a safe no-op, sandbox, dry-run, or echo agent execution path.
6. Phase 6 experimental executor mode: add explicit opt-in only, never as production default dispatch.
7. Phase 7 telemetry dashboard: emit stable non-secret telemetry for `brain-management`.
