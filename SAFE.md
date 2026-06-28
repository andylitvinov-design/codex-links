# SAFE.md — codex-links

Last verified date: 2026-06-28

Purpose: compact safety map for `/safe` sweeps. Store environment variable names only; never store values.

## 1. Project boundary

- Project name: codex-links
- Canonical repo: `andylitvinov-design/codex-links`
- Live URL: https://codex-links.pages.dev
- Related live URL: https://codex-save-cjb.pages.dev (`codex-save/` subproject)
- Preview URL: needs verification
- Hosting provider: Cloudflare Pages
- Production branch/source: `main` per `AGENTS.md`
- Project memory file: `ai-projects-brain/projects/codex-links/PROJECT.md`
- Boundary: Slack/Codex Cloud command bridge, reports surface, inbox UI, delivery timeline, and `codex-save` diagnostics. Do not confuse code fixes with external worker/account linkage.

## 2. Public surface

| Surface | Path / endpoint | Public or auth required | Data accepted | Abuse/cost risk | Owner |
| --- | --- | --- | --- | --- | --- |
| Inbox / dashboard UI | `/` | public page; write actions token-gated | none or UI actions | low unless write endpoints exposed | Andrey |
| Version file | `/version.json` | public | none | stale deploy/version mismatch | Andrey |
| Reports API | `/api/reports` | token required for writes | report payloads | spam/stale reporting if token weak | Andrey |
| Delivery/commands APIs | `/api/delivery`, `/api/commands` | token/admin expected | command payloads | command abuse, paid API/Slack cost | Andrey |
| codex-save UI | `codex-save/` deployed to codex-save Pages | public UI, remediation actions guarded | diagnostics/remediation requests | real command creation risk | Andrey |

## 3. Private/admin surface

| Surface | Path / endpoint | Required role/session | Server-side guard | Data returned | Owner |
| --- | --- | --- | --- | --- | --- |
| Command dispatch | `functions/api/commands.js` | `LINKS_WRITE_TOKEN` / admin token expected | token verification | command status | Andrey |
| Delivery | `functions/api/delivery.js` | token/admin expected | token verification | delivery status | Andrey |
| Reports write | `functions/api/reports.js` | write token expected | token verification | stored report status | Andrey |
| Dispatch library | `functions/_lib/dispatch.js` | internal server function | env/token guard | provider dispatch result | Andrey |
| codex-save remediation | `codex-save/` + functions/KV | admin/write token expected | token/KV checks | diagnostics/remediation state | Andrey |

## 4. Critical frontend journeys

| Journey | Route(s) | Main user actions | Mobile required? | Expected safe result | Last checked |
| --- | --- | --- | --- | --- | --- |
| Inbox home | `/` | open, refresh, navigate reports/delivery | yes | no blank screen, no stale version mismatch | needs verification |
| Command delivery | `/api/commands`, `/api/delivery` via UI/API | unauthorized request, valid token request, retry | yes | unauthorized blocked; valid path does not duplicate commands | needs verification |
| Reports | `/api/reports`, report UI | publish/read report, bad token, malformed payload | yes | safe error, no raw token/provider output | needs verification |
| codex-save diagnostics | codex-save live site | diagnose, cancel, remediation action | yes | no accidental real command without explicit guarded action | needs verification |

## 5. Data inventory

| Data type | Stored where | Sensitive? | Retention/delete notes | Export/delete status |
| --- | --- | --- | --- | --- |
| Command payloads/status | Cloudflare Functions/KV or static data, needs verification | yes | needs verification | needs verification |
| Reports | reports storage/KV/static output, needs verification | medium | needs verification | needs verification |
| Slack/Codex dispatch metadata | function logs/provider responses | yes | do not log tokens/private payloads | needs verification |
| Local secret vault references | local scripts only | yes | names only in repo | needs verification |

## 6. Environment variable names

| Env name | Public browser-safe? | Required where | Purpose | Notes |
| --- | --- | --- | --- | --- |
| `LINKS_WRITE_TOKEN` | no | Cloudflare/GitHub secret | write authorization | never store value |
| `ADMIN_TOKEN` | no | Cloudflare secret | admin authorization | never store value |
| `COMMAND_DISPATCH_MODE` | no | Cloudflare env | dispatch mode | name only |
| `OPENAI_API_KEY` | no | Cloudflare secret | optional direct OpenAI path | paid API; never store value |
| `CLOUD_BRIDGE_BASE_URL` | no | Cloudflare env | cloud bridge route | value not stored here |
| `CLOUD_BRIDGE_SHARED_SECRET` | no | Cloudflare secret | bridge auth | never store value |
| `SLACK_BOT_TOKEN` | no | Cloudflare secret | Slack dispatch | never store value |
| `SLACK_CODEX_DISPATCH_TOKEN` | no | Cloudflare secret | Codex Cloud dispatch | never store value |
| `SLACK_SIGNING_SECRET` | no | Cloudflare secret | Slack verification | never store value |
| `SLACK_CODEX_CHANNEL_ID` | no | Cloudflare env | target channel | value not stored here |
| `SLACK_CODEX_USER_ID` | no | Cloudflare env | target user | value not stored here |
| `SLACK_CODEX_MENTION` | no | Cloudflare env | mention text | value not stored here |
| `SAVE_STORE` | no | Cloudflare KV binding | codex-save data | binding name only |

## 7. Auth and roles

- Auth provider: token-based Cloudflare Functions; Slack signing checks where relevant.
- Roles: owner/admin/write-token clients.
- Admin identifiers stored where: env/token configuration; values never committed.
- Login/logout tested: not applicable unless UI auth exists.
- Direct API access tested: needs verification.

## 8. Database / storage safety

- Database provider: Cloudflare KV/static files, exact bindings need verification.
- User-data tables: not applicable.
- RLS/policies status: not applicable.
- Storage buckets: Cloudflare KV/assets; access rules need verification.
- Service-role usage: none expected.

## 9. Bot, rate-limit, and API-cost controls

| Endpoint/form | Risk | Current control | Missing control | Priority |
| --- | --- | --- | --- | --- |
| `/api/commands` | command spam / paid provider cost | token expected | verify rate limit/replay/idempotency | high |
| `/api/delivery` | duplicate command lifecycle actions | token expected | verify duplicate submit/idempotency | high |
| `/api/reports` | spam/stale report writes | write token expected | verify payload limit and safe errors | medium |
| codex-save remediation | accidental real commands | expected guarded remediation flow | verify confirmation/cancel states | high |

## 10. Frontend UX safety and polish

- Route error boundary exists: needs verification.
- API safe error wrapper exists: needs verification in `functions/api/*`.
- Raw provider/database errors hidden from users: needs verification.
- Loading/empty/success/error/unauthorized states exist: needs verification.
- Duplicate submit guard exists: needs verification for command/report/remediation flows.
- Double-click behavior checked: needs verification.
- Back/refresh behavior checked: needs verification.
- Mobile layout checked: needs verification.
- Desktop layout checked: needs verification.
- Visual polish known issues: version triplet alignment must remain intact.
- Last browser smoke check: needs verification.

## 11. Headers and browser baseline

- CSP or CSP plan: needs verification.
- X-Content-Type-Options: needs verification.
- Referrer-Policy: needs verification.
- Permissions-Policy: needs verification.
- Frame protection: needs verification.
- CORS policy: verify functions restrict non-public write origins/headers.
- HSTS status: needs live verification before claiming.

## 12. Dependency and supply-chain checks

- Package manager: npm.
- Lockfile present: needs verification.
- Dependency audit command: `npm audit` when dependencies are installed.
- Secret scan command: needs verification.
- Agent skills / workflow packages present: command bridge and local helper scripts; optional skill-safety route for scripts that dispatch agents.
- Known accepted findings baseline: none.

## 13. Observability and incident response

- Error logging provider: Cloudflare Pages Functions logs and GitHub Actions.
- Deployment logs location: Cloudflare Pages / `.github/workflows/deploy-production.yml`.
- Health check URL: live home and `/version.json`.
- Rollback method: `npm run rollback:prepare` plus revert/redeploy from `main`; exact last-good commit needs verification.
- Backup status: GitHub history/KV export needs verification.
- Last known good deploy/commit: needs verification.
- Incident contact / owner: Andrey.

## 14. Safe verification commands

```bash
npm test
npm run smoke:release
npm run cloud:check
```

## 15. Frontend smoke checks

```text
- Open live home page and /version.json.
- Check desktop and mobile layout.
- Try protected write endpoints without token and confirm safe unauthorized response.
- Verify reports and delivery pages do not show raw provider errors or tokens.
- Double-click/refresh retry any safe UI submit action and confirm no duplicate command/report.
- For codex-save, verify diagnose/cancel/remediation confirmation states before any real command side effect.
```

## 16. Known risks / needs verification

- `needs verification`: live Cloudflare Pages deploy source and latest SHA.
- `needs verification`: token guards on all write endpoints.
- `needs verification`: duplicate command/report/remediation idempotency.
- `needs verification`: headers/CORS baseline.

## 17. Last /safe result

- Date: 2026-06-28
- Routes selected: Cloudflare API/functions + frontend route + Slack/command bridge + paid API/provider cost + frontend UX + rollback/observability.
- Frontend routes/actions checked: code/doc-only in this PR; live browser checks not completed.
- Critical findings: none proven.
- High findings: none proven.
- Fixes applied: repo-level safety map added.
- PRs opened: this PR.
- Checks run: project memory, AGENTS, package scripts review.
- Checks not run: npm tests, Cloudflare live smoke, authenticated/tokened flows.
- Live verified: needs verification.
- Next action: run live smoke and token-guard checks before merge/deploy.