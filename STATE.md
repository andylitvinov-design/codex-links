# STATE

Updated: 2026-05-16

## Current Goal

Make `codex-links` the stable Cloudflare Pages command bridge for Codex Cloud, Slack-backed delivery, reports, inbox/timeline visibility, and `codex-save` diagnostics.

## Current Operating State

- Production surface: [https://codex-links.pages.dev](https://codex-links.pages.dev)
- Canonical repo: [https://github.com/andylitvinov-design/codex-links](https://github.com/andylitvinov-design/codex-links)
- Default command route: Slack-backed Codex Cloud through `COMMAND_DISPATCH_MODE=cloud-via-slack`.
- Optional direct route: direct OpenAI, only when `OPENAI_API_KEY` is configured.
- External linkage: Slack worker/account validation and Cloudflare Pages env settings are live configuration, not repo code.

## Current Known Risk

- `public/version.json` and `public/app.js` show build `20260505-2149`, while the top cache-busting script and stylesheet in `public/index.html` still reference `20260425-2001`. Treat this as a release hygiene issue before the next shipped UI change.
- OpenClaw feedback loop is now read-only only: `npm run feedback:verify` checks public live URLs for `finance` and `reiki-yggdrasil`, but it is not a production executor and does not dispatch, deploy, or mutate anything.
- OpenClaw Telegram setup is staged as local-safe tooling only: `npm run setup:openclaw:telegram` enforces pairing DM policy, allowlist group policy, and no wildcard groups; `npm run doctor:openclaw:telegram` checks Cloudflare secret presence separately from the local daemon environment without printing secret values.
- Latest live feedback check: finance live endpoints are reachable and `/api/status` reports commit `953cfc607636ce4894af5c39457cf9c9711de894`, but result is `needs_verification` without an expected commit; reiki root is reachable, while `/profile`, `/masters`, and `/profile/admin` returned `404`.

## Next Steps

- For delivery bugs, prove the failing layer first: repo code path, live Cloudflare response, Slack/Codex Cloud worker linkage, or local bridge.
- Before shipping UI changes, align `public/version.json`, `public/app.js`, and all `public/index.html` version references.
- For OpenClaw feedback, add a public version/status endpoint to `reiki-yggdrasil` and rerun finance with `--expected-commit <sha>` when proving a specific deploy.
- For OpenClaw Telegram, put `TELEGRAM_BOT_TOKEN` into the local OpenClaw daemon environment before enabling Telegram; the Cloudflare Pages encrypted secret does not automatically reach the local daemon.
- After every project task, append a short `LOG.md` entry and keep this state current enough for the next Codex session.
