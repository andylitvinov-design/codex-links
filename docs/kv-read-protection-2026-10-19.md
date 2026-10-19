# KV read protection — 2026-10-19

Follow-up to issue #180. This is not the default-on standby from PR #179.

## Proven code-level causes

The delivery snapshot and bridge-status derivation read some identical command/config keys independently. The existing baseline fixture records 18 get operations for three commands, three messages and two reports. Existing 1-second/3.5-second active polling has no server-side cooldown after a KV quota error.

## Patch

- Codex Links Pages API middleware runs the unchanged delivery/status readers with per-request get memoization. Parallel and repeated JSON/text reads share an in-flight promise, but return independent JSON values. Successful values never survive a request. Writes invalidate the memo.
- A five-minute, automatically expiring GET-only circuit breaker recognizes KV-specific 429 errors. Subsequent reads return a neutral 429 plus Retry-After without entering a KV handler. A small Cache API marker contains only the expiry timestamp and version, not user data. It costs no KV operations.
- Codex Save gets its own SAVE_STORE-scoped GET cooldown through its separately deployed Pages project.
- Existing POST, callback, authentication, OPTIONS, shared feed, client filtering, command lifecycle, schema and stored data remain unchanged. No paid plan, secrets, account settings, default standby, or background jobs are introduced.

## Verification

Local helper tests: 12/12 passed on Node 22.16.0. Integration tests compare the old real handler with the middleware and preserve all existing tests. CI must prove exact source before release. Synthetic expected budgets: shared full 18 -> 14, client-scoped 14 -> 12, missing client index 20 -> 16. These are not measured production savings.

## Release boundary

No production claim follows from a branch or PR. The previous release pause is not lifted by this document. Verify current production source, exact-head CI, and both independent Pages deployments under the existing release gates. Do not deploy a preview against shared production KV just to smoke-test. No UI files changed, so the current version triplet remains unchanged; use deployment SHA to prove this server-only release.

PR #179 and this patch both add API middleware: do not combine them mechanically. PR #179 intentionally suspends all APIs; this patch does not. Security issue #174 and remediation PR #177 remain separate and unresolved.

Cloudflare account-wide attribution (including MOBILE_RUNS and other Workers) remains unverified until authenticated namespace metrics are available. Cache API is local to a Cloudflare data center and may be evicted; this protection is not a global quota guarantee or a replacement for usage attribution. Normal healthy large-history reads can still consume substantial quota.

Rollback: revert this focused patch. There is no data migration. Any cooldown marker expires within five minutes.
