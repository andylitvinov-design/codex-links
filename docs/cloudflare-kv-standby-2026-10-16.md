# Cloudflare KV emergency standby (2026-10-16)

## Scope and observed cause

This is an emergency *reversible* safety switch for the otherwise idle `codex-links` and `codex-save` Pages projects. It does not migrate or delete KV data and does not change a Cloudflare account, billing plan, credential, or Worker route.

Source audit found:
- `/api/delivery?scope=public` reads **18 KV entries** in the existing synthetic fixture (`tests/delivery-polling.test.mjs`), which is *not* an account-wide production metric.
- `public/app.js` still polls once per minute while idle (PR #176); active commands can poll more frequently.
- Legacy local Codex/Claude bridges can run with `KeepAlive=true` and query empty queues repeatedly.
- Unauthenticated default command creation is still a separate security issue (#174). Draft PR #177 covers a subset of Codex Save authorization.

## What is stopped (when this branch reaches a Pages deployment)

- `functions/api/_middleware.js` returns a neutral 503 **before** any `/api/*` handler, KV read/write, Slack dispatch or worker maintenance. This also blocks commands created from the public UI.
- `functions/add.js` returns the same 503 before token authorization or its KV writes.
- `codex-save/functions/api/_middleware.js` stops **its own** API, including diagnostics and remediation, before `SAVE_STORE` usage.
- The static Pages UI and its assets remain available. API-backed features display unavailable until explicitly resumed. Some clients may keep making cheap failed HTTP requests; no KV is read by these guards.
- Neither guard affects a separate short-link redirect Worker or other Cloudflare Pages projects; these must be attributed independently.

Both sites are **standby by default**, without requiring any secret/env value. Only after the owner explicitly accepts the risks of unpausing, the project-specific public configuration toggles `CODEX_LINKS_STANDBY` and `CODEX_SAVE_STANDBY` can disable the guard. Avoid resuming the public command route until issue #174 is resolved. Do not put write tokens in browser-side configuration.

## Deployment / verification gate

No merge/deploy/account-setting change is performed by this patch.

1. Run `node --test tests/standby-middleware.test.mjs`, `npm test`, and `npm run smoke:release`, plus `node --check` on changed JS files.
2. Check CI for the exact PR head. Do not run smoke jobs that create real Cloudflare commands while quotas are exhausted.
3. Owner review -> merge to `main` -> Cloudflare Pages deployment of `codex-links` and the **separate** `codex-save` project (confirm its GitHub source/deploy linkage first).
4. On production, verify a single `GET /api/delivery` and `GET /api/diagnostics/run` produce HTTP 503 + `code=service_standby`. Verify `/version.json` remains reachable. Avoid automated repeated production probes.
5. Compare **per-namespace** KV reads, Worker routes, bot traffic, and CPU in Cloudflare Observability before and after. Unknown namespaces/Workers are `needs verification`, not proof of this repo's consumption.
6. On the Mac, read-only `launchctl print`/process checks should identify legacy `com.andriilitvinov.codex-links-bridge`, `com.andriilitvinov.codex-links-claude-bridge`, `com.codexlinks.claude-bridge`, and `links-inbox` before any reversible `bootout`. Do not delete .plist, Keychain items or secrets. The Mac must be online and available for execution.

## Rollback and risks

Revert this PR (and deploy both Pages surfaces) to restore previous behavior, or explicitly control each standby toggle after verifying the owner command/auth boundary. Rolling back without addressing issue #174 reopens unauthenticated command creation. Restoring the old bridges may revive KV read pressure. This guard does not mitigate requests hitting a distinct external redirect Worker, and does not replace Cloudflare bot/rate-limit rules at account level.
