# Codex Links Error And Release Log

Period: `2026-04-23`

This log captures the concrete production issues, the fixes that landed, the commit chain, and the current live deployment state so the recovery work is preserved outside chat history.

## Confirmed Errors

### Slack cloud delivery

- `codex_target_actor_unverified` could happen before real Slack dispatch, leaving commands visually stuck in a yellow in-progress state.
- Successful actor validation still depended on a live probe, which created repeated probe noise in Slack and slowed dispatch.
- `SLACK_FIRST_ACK_TIMEOUT_MS` was too short for real Slack delivery conditions on text commands.
- Photo commands routed through `Slack-first` could fail after thread creation and remain harder to recover.

### UI and release hygiene

- UI controls regressed and some expected buttons were missing from the rendered page.
- `public/version.json`, `public/app.js`, and cache-busting URLs in `public/index.html` drifted out of sync after a live release.

### Operational findings

- The local bridge was not the only risk surface; even with bridge runners alive, the Slack cloud path could still fail due to validation and first-ack policy.
- Existing launchd bridge/watchdog tooling was present, so the remaining reliability work was in routing and timeout policy rather than in creating a runner from scratch.

## Solutions Landed

### Delivery lifecycle

- Early Slack actor-validation failures now terminate cleanly or reroute instead of hanging indefinitely.
- Successful Slack actor validation is cached for a short TTL to reduce repeated live probes.
- Maintenance now cleans up stale pre-dispatch Slack failures instead of leaving them active.

### Routing and fallback

- Photo commands now default to `local-bridge` instead of `Slack-first`.
- Photo Slack failures can now reroute to bridge instead of failing immediately.
- Text Slack first-ack window was increased to `60s`.
- Explicit direct-cloud opt-in for photo commands remains supported.

### UI and release safety

- Missing UI controls were restored.
- Live build metadata was re-aligned so the shipped version, app build constant, and cache-bust URLs match again.
- User-facing status text for Slack actor failures now reflects the actual failure mode instead of a vague processing state.

## Commit Chain

### UI and release polish

- `252ef73` `fix: restore missing links UI controls`
- `2a2cb7f` `Merge pull request #115 from andylitvinov-design/codex/ui-release-polish-20260423`
- `a1aa813` `fix: bump live build version`
- `3a47659` `Merge pull request #117 from andylitvinov-design/codex/bump-live-build-version-20260423`

### Slack cloud stabilization

- `99cdaef` `fix: stabilize slack cloud dispatch fallbacks`
- `373fdac` `fix: cache slack actor validation probes`
- `fbf49aa` `Merge pull request #116 from andylitvinov-design/codex/stabilize-slack-dispatch-20260423`

### Photo routing and fallback hardening

- `732d2a4` `fix: reroute photo slack failures to bridge`
- `dda2631` `Merge origin/main into codex/fix-slack-photo-fallback-20260423`
- `a19cde2` `Merge pull request #118 from andylitvinov-design/codex/fix-slack-photo-fallback-20260423`

## PRs

- [#115](https://github.com/andylitvinov-design/codex-links/pull/115)
- [#116](https://github.com/andylitvinov-design/codex-links/pull/116)
- [#117](https://github.com/andylitvinov-design/codex-links/pull/117)
- [#118](https://github.com/andylitvinov-design/codex-links/pull/118)

## Verification

- Full test suite after the final routing/fallback work: `89 pass, 0 fail`
- Production API status check returned `200`
- Live version after release hygiene fix:
  - `public/version.json` -> `20260423-1605`

## Current Live State

- Production site: [codex-links.pages.dev](https://codex-links.pages.dev/)
- Latest verified preview deploy from the final routing release: [fa4b0b51.codex-links.pages.dev](https://fa4b0b51.codex-links.pages.dev/)
- Production branch remains `main`

## Remaining Risks To Watch

- Slack cloud delivery still depends on the external Slack/Codex actor actually answering in-thread.
- Bridge runtime health should still be monitored operationally even though the code-path fixes above are now deployed.
- Any future shipped UI change must keep these files aligned:
  - `public/version.json`
  - `public/app.js`
  - cache-busting asset URLs in `public/index.html`
