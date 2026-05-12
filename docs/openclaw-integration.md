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

Runtime integration details are still `needs verification`. This readiness layer verifies the local binary, `--version` response, `--help` command list, and a safe read-only `openclaw status --json --timeout 2000` probe. It does not verify OpenClaw auth, model provider login, artifact output, or agent command execution.

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

Observed CLI capabilities in this pass:

- `openclaw --help` is available and lists `status`, `health`, `doctor`, `config validate`, `agent`, `tasks`, gateway commands, and other subcommands.
- `openclaw status --json --timeout 2000` is a safe read-only command and completed locally.
- The local gateway service is installed and running, but `status` reported gateway reachability as `false` with `error: timeout` during this probe.
- No documented safe no-op, dry-run, or echo-style agent run command was identified from top-level help.

Therefore `run_supported` remains `false` and `needs_verification` remains `true` until a follow-up PR proves an explicit no-op or sandboxed local agent execution contract.

## Future Local Executor Contract

OpenClaw may later connect to Codex Links as a local executor mode after a separate implementation and verification pass.

Minimal future command contract:

- `executor`: `openclaw`
- `input`: command text, `projectKey`, repo, and safe context
- `output`: status, stdout summary, stderr summary, artifacts, exact checks
- telemetry event: `openclaw_check` or `openclaw_run`
- telemetry fields: success or failure, duration, binary name, version, and non-secret error summary

All command execution, auth, daemon, gateway, artifact handling, and timeout behavior remains `needs verification`.

The current local adapter boundary is a contract only. OpenClaw is not an active production executor yet, and production dispatch behavior is unchanged.

## Must Not Replace Yet

OpenClaw must not replace these paths until an explicit follow-up PR proves the new executor end to end:

- Slack-backed Codex Cloud command path
- existing Cloudflare Pages command lifecycle
- existing reports and delivery APIs
- local bridge or Claude bridge launchd operations
- direct OpenAI opt-in route

## Brain Management Telemetry

No `brain-management` telemetry is changed in this readiness PR. The next safe step is to add OpenClaw readiness metrics there only after Codex Links emits `openclaw_check` or `openclaw_run` events with a stable non-secret contract.
