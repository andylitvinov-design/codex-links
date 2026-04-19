# Cloud Worker Ack Contract

This document is the handoff spec for the external Codex/Slack worker that executes `slack-codex-cloud` commands for Codex Links.

## Goal

The worker must acknowledge startup early and explicitly so Links can distinguish:

- `Slack message posted`
- `worker actually started`
- `photo file is actually readable by the worker`

Links will treat generic thread activity as non-ack.

## Required Startup Ack

For text commands, the worker must post this in the same Slack thread before doing substantive work:

```text
CODEX_LINKS_EXECUTION_ACK {"type":"CODEX_LINKS_EXECUTION_ACK","status":"started"}
```

For photo commands, the worker must first confirm authenticated access to the uploaded Slack file, then post this in the same Slack thread:

```text
CODEX_LINKS_EXECUTION_ACK {"type":"CODEX_LINKS_EXECUTION_ACK","status":"started","photo_ready":true}
```

Links-side acceptance rules:

- only `CODEX_LINKS_EXECUTION_ACK` counts as startup ack
- for photo commands, `photo_ready=true` is mandatory
- helper bot messages, upload notices, and generic progress replies do not count

## Required Earliest Proof Points

During this incident, the worker must make the earliest stop-point observable before any long-running work.

Required internal checkpoints:

- `event_received`
- `thread_recognized`
- `handler_started`

Required behavior:

- after `event_received`, the worker should know which Slack event or poll item triggered work
- after `thread_recognized`, the worker should know the exact `channel` and `thread_ts`
- after `handler_started`, the worker should have entered the first request handler for that thread
- for photo commands, the worker must fetch the Slack-hosted file with authenticated Slack access before posting startup ack
- if startup fails before ack, the worker must post one compact threaded diagnostic reply naming the failure class

Recommended temporary diagnostic payload shape:

```text
CODEX_LINKS_WORKER_DIAG {"type":"CODEX_LINKS_WORKER_DIAG","stage":"thread_recognized","channel":"C...","thread_ts":"...","failure_class":""}
```

Rules:

- diagnostics must be flag-gated and default off
- diagnostics must stay compact
- diagnostics must not replace the structured startup ack
- diagnostics must include `channel` and `thread_ts` when known

## Worker Read Path

The worker is expected to:

1. Read the root task message in the dispatch channel thread.
2. Read thread replies to discover the uploaded photo helper message and file metadata.
3. For photo commands, fetch the Slack hosted file with authenticated Slack access.
4. Send startup ack only after the file fetch is confirmed for photo commands.

Do not treat the permalink alone as proof the file is readable.

## Failure Reporting

If the worker cannot start, it must reply in the same Slack thread with an explicit failure or diagnostic message instead of silently waiting.

Minimum failure classes to distinguish:

- wrong channel or wrong thread
- thread readable, file not present
- file present, authenticated file fetch denied
- event received, but thread not recognized
- thread recognized, but handler not started
- Slack rate limit before ack post
- Slack API error during thread reply
- malformed ack payload

## Validation Checklist

- text smoke produces threaded `CODEX_LINKS_EXECUTION_ACK`
- photo smoke produces threaded `CODEX_LINKS_EXECUTION_ACK` with `photo_ready=true`
- photo ack appears only after real file-read confirmation
- worker reply is threaded, not unthreaded
- worker can still post diagnostics when file-read fails
