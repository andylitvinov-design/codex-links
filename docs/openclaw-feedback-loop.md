# OpenClaw Feedback Loop

## Why This Exists

ChatGPT/Codex often finishes a PR or deploy task but still needs a reliable answer to one operational question: did the live site update to the expected commit or version?

This feedback verifier gives Codex a compact read-only check it can run from the terminal and paste back into the conversation or later store in the Codex Links delivery timeline.

## What It Does

Run:

```bash
npm run feedback:verify -- --project finance --expected-commit <sha> --json
npm run feedback:verify -- --project finance --json
npm run feedback:verify -- --project reiki-yggdrasil --json
```

The verifier performs GET-only live checks with timeouts and bounded response reads. It prints compact JSON by default when `--json` is passed, including the project key, live URL, observed commit/version when available, required check summaries, the exact failing check when one exists, and the next action.

Supported options:

- `--project <key>`: required.
- `--expected-commit <sha>`: optional expected live commit.
- `--expected-version <version>`: optional expected live version.
- `--live-url <url>`: optional live URL override.
- `--json`: print one machine-readable JSON object.
- `--timeout-ms <number>`: optional timeout, default `10000`.

## What It Does Not Do

This verifier does not deploy, merge, push, delete, edit production services, read `.env`, print environment variables, print secrets, run unrestricted OpenClaw commands, or wire OpenClaw into production dispatch.

It does not change Cloudflare routing, Slack delivery, reports APIs, delivery APIs, or deployment configuration.

## Supported Projects

`finance`: EzoHata Incoming Ledger at `https://ezohata-incoming-ledger.vercel.app`.

- GET `/api/status`.
- Extract `status`, `commitSha`, `commitRef`, and `googleSheetReadOk` when present.
- GET `/api/audit-snapshot`.
- Summarize only HTTP status, JSON parse status, `ok/status`, and warning count.
- Compare `--expected-commit` against `/api/status` `commitSha` when provided.

`reiki-yggdrasil`: Reiki Yggdrasil site at `https://reiki-yggdrasil.vercel.app`.

- GET `/`.
- GET `/profile`.
- GET `/masters`.
- GET `/profile/admin`.
- Record status and reachability only.
- Do not require login and do not print large HTML.

Reiki Yggdrasil does not currently expose a public version/status endpoint through this verifier, so `observedCommit` and `observedVersion` remain `null`, and version verification remains `needs_verification`.

## How ChatGPT/Codex Should Use It

After PR/deploy work, pass the expected commit or version when available:

```bash
npm run feedback:verify -- --project finance --expected-commit <sha> --json
```

Treat `pass` as live verification. Treat `fail` as a concrete live mismatch or endpoint failure and use `exactFailingCommand` as the next debug target. Treat `needs_verification` as live reachable but not provably updated, usually because no expected commit/version was passed or no public version endpoint exists.

## Future Integration

Later Codex Links can call this verifier from the delivery timeline and store the compact result with each delivery event.

Later `brain-management` can consume stable non-secret telemetry events from these checks.

Later OpenClaw can become an experimental executor only after gateway health, auth, no-op execution, artifact output, timeout behavior, and telemetry are verified. This PR keeps OpenClaw as readiness/probe-only and does not make it a production executor.
