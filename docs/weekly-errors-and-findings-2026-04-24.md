# Codex Links Weekly Error And Findings Log

Period: `2026-04-17` to `2026-04-24`

This log captures the key production errors, project-facing regressions, release mistakes, and the fixes that landed during the last week so the recovery path stays visible outside chat history.

## Confirmed Errors

### Slack cloud routing and acknowledgement

- `cloud-via-slack` could look selected in the UI while real delivery still degraded to the wrong executor path or fell back too early.
- Slack actor validation was too brittle and could fail before real dispatch, leaving commands in a misleading in-progress state.
- First-ack timing was too aggressive for real Slack/Codex response latency, especially on text commands.
- Photo requests on the Slack path could create the thread and still fail later during upload or reply handling.

### Bridge and delivery recovery

- Bridge claim and timeout behavior still had edge cases where healthy work could look stale or be retried too early.
- Delivery maintenance and status handling needed repeated hardening to avoid stale queue/index state and misleading command phases.

### UI and release safety

- Multiple UI regressions landed during the week:
  - missing links controls
  - collapsed Codex reply cards
  - broken report source links/highlights
- Release metadata drift remained a real production risk:
  - `public/version.json`
  - `public/app.js`
  - cache-busting URLs in `public/index.html`
- The live site could enter a visible version-reload loop when different Pages edge responses served mismatched HTML/bootstrap metadata.

## Project-Facing Impact

### Links main UI

- Users could see the page visibly "jump" or reload while the client tried to reconcile different live versions.
- Timeline and reply UX regressed more than once and needed restoration passes before the current live state.

### Slack cloud delivery

- Cloud-selected commands were not consistently trustworthy because validation, first-ack timing, and photo handling could redirect execution or leave status unclear.
- The highest-value reliability work this week was not new routing design, but making the existing Slack cloud path honest about what actually happened.

### Project targeting

- The project manifest was extended to include the `ezohata ads` target so that routing and project selection stay aligned with real repo/workspace targets.
- Bridge text-lane reservation and timeout tuning were needed so one class of work would not starve or misclassify another.

## Solutions Landed

### Delivery and routing

- Slack actor validation was restored and hardened so active worker activity can satisfy validation without excessive probe noise.
- Slack dispatch fallbacks were stabilized and the first-ack policy was relaxed for real delivery conditions.
- Photo handling on the Slack path was hardened twice:
  - route photo commands through the intended path
  - reroute failed Slack photo deliveries safely to bridge when needed
- Bridge timeout and text-lane behavior were tightened so local execution stays predictable under mixed workloads.

### UI and reports

- Missing links UI controls were restored.
- Grouped/collapsed Codex reply cards were restored.
- Report source links and management highlights were fixed so reports remain usable from the live interface.

### Release hygiene and live-site stability

- Build metadata was bumped and re-aligned after drift between shipped assets and the advertised version.
- The live bootstrap was changed to stop forcing a navigation on initial page load.
- Automatic hard reload on version drift was replaced with a manual refresh prompt, which prevents the live site from bouncing between inconsistent edge-served versions.

## Key PRs And Merges

- [#107](https://github.com/andylitvinov-design/codex-links/pull/107) `Harden photo delivery routes`
- [#108](https://github.com/andylitvinov-design/codex-links/pull/108) `Fix reports links and preserve management highlights`
- [#109](https://github.com/andylitvinov-design/codex-links/pull/109) `Harden delivery flows and finalize live release`
- [#110](https://github.com/andylitvinov-design/codex-links/pull/110) `Fix release asset cache busting`
- [#111](https://github.com/andylitvinov-design/codex-links/pull/111) `Fix Slack cloud actor validation for bot sender route`
- [#112](https://github.com/andylitvinov-design/codex-links/pull/112) `Restore Slack actor validation for active Codex worker`
- [#113](https://github.com/andylitvinov-design/codex-links/pull/113) `Restore grouped Codex reply UI`
- [#114](https://github.com/andylitvinov-design/codex-links/pull/114) `Support configurable Slack actor freshness window`
- [#115](https://github.com/andylitvinov-design/codex-links/pull/115) `fix: restore missing links UI controls`
- [#116](https://github.com/andylitvinov-design/codex-links/pull/116) `fix: stabilize slack cloud dispatch fallbacks`
- [#117](https://github.com/andylitvinov-design/codex-links/pull/117) `fix: bump live build version`
- [#118](https://github.com/andylitvinov-design/codex-links/pull/118) `fix: reroute photo slack failures to bridge`
- [#120](https://github.com/andylitvinov-design/codex-links/pull/120) `fix: route photo commands through slack cloud`
- [#121](https://github.com/andylitvinov-design/codex-links/pull/121) `Restore collapsed Codex reply cards`
- [#122](https://github.com/andylitvinov-design/codex-links/pull/122) `feat: add ezohata ads project target`
- [#123](https://github.com/andylitvinov-design/codex-links/pull/123) `Stabilize Slack dispatch and bridge delivery`
- [#124](https://github.com/andylitvinov-design/codex-links/pull/124) `fix: restore honest slack cloud validation and photo delivery handling`
- [#125](https://github.com/andylitvinov-design/codex-links/pull/125) `chore: bump release version for slack cloud route fix`
- [#126](https://github.com/andylitvinov-design/codex-links/pull/126) `fix: stop live version reload loops`

## Verification

- Local release consistency check passed:
  - `node scripts/smoke-release.mjs`
- Full automated test suite passed on the current fix:
  - `111 pass, 0 fail`
- Live production now serves aligned release metadata:
  - `public/version.json` -> `20260423-2118`

## Current Live State

- Production site: [codex-links.pages.dev](https://codex-links.pages.dev/)
- Latest production merge in scope: `9164cd8` `Merge pull request #126 from andylitvinov-design/codex/fix-live-version-reload`
- Latest verified production deployment in scope: `5e36e69f-370c-4155-962c-d1db3ba18434`

## Remaining Risks To Watch

- Slack cloud delivery still depends on the external Slack/Codex worker answering in-thread with acceptable latency.
- Future UI releases must keep version metadata aligned in all three places:
  - `public/version.json`
  - `public/app.js`
  - cache-busting asset URLs in `public/index.html`
- Any future auto-update logic should assume Pages edge responses can be temporarily inconsistent during rollout and should avoid forced reload loops.
