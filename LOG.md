# LOG

## 2026-05-15

- Added `docs/chatgpt-openclaw-codex-loop.md` and `docs/examples/chatgpt-openclaw-codex-loop.example.json` for the ChatGPT/OpenClaw/Codex approval-loop contract.
- Added `npm run loop:proposal` as a dry-run-only proposal generator with JSON and compact key/value output; it does not dispatch to Codex, OpenClaw, Slack, Cloudflare, or production services.
- Added tests for proposal generation, required approval guardrails, missing repo/prompt verification notes, status validation, and compact output.
- Updated `STATE.md` to mark direct same-ChatGPT-thread callback as `needs verification`, keep Codex Links inbox/timeline as the bridge surface, and keep production dispatch unchanged.
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
