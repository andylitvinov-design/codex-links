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

Runtime integration details are still `needs verification`. This readiness layer only verifies the local binary and `--version` response. It does not verify OpenClaw auth, daemon state, gateway health, model provider login, or command execution.

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

## Future Local Executor Contract

OpenClaw may later connect to Codex Links as a local executor mode after a separate implementation and verification pass.

Minimal future command contract:

- `executor`: `openclaw`
- `input`: command text, `projectKey`, repo, and safe context
- `output`: status, stdout summary, stderr summary, artifacts, exact checks
- telemetry event: `openclaw_check` or `openclaw_run`
- telemetry fields: success or failure, duration, binary name, version, and non-secret error summary

All command execution, auth, daemon, gateway, artifact handling, and timeout behavior remains `needs verification`.

## Must Not Replace Yet

OpenClaw must not replace these paths until an explicit follow-up PR proves the new executor end to end:

- Slack-backed Codex Cloud command path
- existing Cloudflare Pages command lifecycle
- existing reports and delivery APIs
- local bridge or Claude bridge launchd operations
- direct OpenAI opt-in route

## Brain Management Telemetry

No `brain-management` telemetry is changed in this readiness PR. The next safe step is to add OpenClaw readiness metrics there only after Codex Links emits `openclaw_check` or `openclaw_run` events with a stable non-secret contract.
