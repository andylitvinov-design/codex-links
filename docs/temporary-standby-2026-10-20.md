# Codex Links: временная пауза / Temporary maintenance (2026-10-20)

## Reason and scope

Owner explicitly requested temporarily disabling Codex Links to contain recurring Cloudflare Workers KV read-quota outages. Earlier account analytics on October 20 showed 115,802 daily reads for LINKS_STORE. Do NOT merge PR #179, which also disables the unrelated Codex Save site.

Only the Cloudflare Pages project codex-links at https://codex-links.pages.dev is changed. The independent codex-save and other sites are left untouched. No KV data, bindings, credentials, Cloudflare plan, local Mac jobs or stored command/message/report records are changed.

## Behavior

The root functions/_middleware.js intercepts before static assets and Pages Functions:

- GET pages and assets: bilingual maintenance HTML with HTTP 503.
- All API routes, Slack or other webhooks, legacy /add and write methods: JSON service_paused HTTP 503.
- GET or HEAD /version.json alone: passes through to the original static asset for release verification.

No KV is read or written; no normal handler is invoked. There is no URL, cookie, environment-variable or timer bypass and no automatic reopening. Old browser clients might still request APIs but those return 503 before storage.

This intentionally stops new commands, response synchronization, webhook acknowledgments and bridge writes. Tasks already in flight may not be able to persist their results; tell the owner this clearly.

## Deployment and proof

Use branch -> reviewed PR -> merge main -> Cloudflare Pages exact-SHA deployment via existing deploy-production.yml. The new one-off workflow is triggered only by its unique release marker on a purpose-named merge and dispatches the already verified production workflow. The release verifies all unit tests, static build integrity, and exact source. Never claim the site is paused from GitHub merge alone.

After successful deployment, verify independently in the Cloudflare account that the production commit matches the exact main merge SHA, its stage is success, and uses_functions=true. Run one public HTTP GET each:

- https://codex-links.pages.dev/ => 503 text/html containing Сервис временно приостановлен
- https://codex-links.pages.dev/api/delivery?scope=public => 503 JSON service_paused
- https://codex-links.pages.dev/version.json => 200 static JSON with the existing build marker

Do not POST commands or fetch KV keys, even for a smoke test. Record the deployment and verification in issue #180.

## Limits and resumption

This prevents Workers KV operations *originating from the Codex Links production Pages deployment*. Other Workers, older previews pointing at the same namespace, and external REST/KV clients may still consume quota; measure after the pause and investigate independently if necessary.

**Restore ONLY on a new explicit owner request:** create a focused PR deleting root functions/_middleware.js (optionally retiring the one-off release files), test, merge main, explicitly deploy that new exact SHA through deploy-production.yml, then verify Pages canonical deployment and healthy authenticated behavior. Never delete KV data or upgrade plans simply to restore a paused site.
