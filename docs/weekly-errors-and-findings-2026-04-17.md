# Codex Links Weekly Error And Findings Log

Period: `2026-04-10` to `2026-04-17`

This log captures the main delivery errors, UI regressions, routing findings, and operational discoveries touched during the last week so they do not get lost across chat threads.

## Confirmed Errors

### Delivery and reply path

- `Codex Cloud` dispatch could succeed while the app still timed out waiting for a reply.
- Some cloud replies arrived outside the original Slack thread and were not always matched back to the command in time.
- `GET /api/commands` polling could contribute to noisy retry behavior instead of only observing state.
- In live production checks, both cloud and bridge smoke could show missing manifest context fields such as `targetWorkspacePath`, which means production was not yet on the expected context-routing build.

### Bridge and fallback behavior

- Legacy `acked` states were still visible, which made terminal delivery outcomes less clear than `answered` or `failed`.
- Bridge delivery could be healthy while cloud path still fell back too often, which hid the narrower cloud reply issue.

### UI regressions

- Mobile layout drift reintroduced older composer and timeline states and needed multiple restoration passes.
- The project menu appeared twice: once in the top section and again near the composer.
- Audio notifications played too often because any new assistant message could trigger sound, including technical/system messages.
- Photo submission in cloud mode failed at the form layer instead of degrading safely to bridge.

### Release and operational errors

- `smoke:release` failed when `public/version.json`, `public/app.js`, and cache-busting asset URLs in `public/index.html` drifted out of sync.
- Heartbeat automation creation for recurring delivery checks failed at the tool layer, so automated notifications could not be enabled from the app despite having the desired spec ready.

## Main Findings

### Delivery architecture

- The intended production path is now `Cloudflare Pages UI/API -> Slack -> Codex Cloud`, with the local Mac bridge retained as fallback.
- The project dispatch manifest is the correct source of truth for:
  - menu structure
  - project category and label
  - GitHub repo target
  - workspace path
  - ordered context files

### Context routing

- Correct context for `links` is:
  - project: `myprojects / links`
  - repo: `andylitvinov-design/codex-links`
  - workspace path: `/Users/andriilitvinov/projects/MYPROJECTS/links`
  - root context files: `AGENTS.md -> README.md -> STATE.md`
- The bridge prompt now has a project-scoped form and should no longer forward only the raw user request.
- Cloud-ready projects should remain explicit; `bridge-only` projects must stay visible in the UI but blocked from cloud dispatch.

### Monitoring and smoke coverage

- Text smoke alone is not enough. Delivery health must also validate that the created command contains the expected manifest context fields.
- Separate smoke coverage is needed for:
  - cloud dispatch and reply
  - bridge dispatch and reply
  - manifest context presence on both paths

## Fixes Landed During The Week

### Delivery and routing

- `2026-04-14` `5663668` `chore: prepare cloud-ready links repo`
- `2026-04-14` `0ee9df9` `feat: improve thread filtering and photo ingestion`
- `2026-04-14` `c9d1143` `feat: supersede stale pending commands`
- `2026-04-17` `2ef19ff` `fix: stabilize live cloud and bridge delivery`
- `2026-04-17` `22308ff` `Fix message delivery routing and cloud fallback (#12)`
- `2026-04-17` `b5b2f61` `Improve cloud delivery fallback and bridge diagnostics`
- `2026-04-17` `cc6b147` `Match unthreaded cloud replies to recent commands`
- `2026-04-17` `f352a69` `Fix cloud command thread routing`

### UI and mobile restoration

- `2026-04-16` `370d713` `feat: restore 2026-04-15 codex-links release`
- `2026-04-16` `c7d54d0` `fix: restore later links UI message fixes`
- `2026-04-16` `c360fb6` `fix: restore 20260415-2110 links layout`
- `2026-04-16` `42d0640` `fix: merge later message UI and relax slack target validation`
- `2026-04-16` `19d3e6a` `Fix reply thread selection and bridge badges`
- `2026-04-16` `1498645` `Fix mobile thread menu layout`
- `2026-04-16` `94a4473` `Fix public feed loading and mobile composer reset`
- `2026-04-16` `9f4f0f3` `Restore compact mobile thread layout`
- `2026-04-16` `5578769` `Restore previous message timeline style`
- `2026-04-16` `983be0b` `Restore old lower composer styling`
- `2026-04-17` `e7f9682` `feat: split dialog and notifications tabs`
- `2026-04-17` `b3f6312` `Unify links menu around canonical repos`

## Local Findings Not Yet Safe To Forget

These were confirmed in the current workspace and should be preserved even if they are not yet deployed everywhere:

- Sound now should trigger only for:
  - a new Codex reply
  - a new item in the notifications tab
- The lower duplicate project selector was removed; project choice should stay only in the upper area as a dropdown.
- If a user attaches a photo while cloud mode is selected, the UI should silently route that request through bridge instead of hard-failing.
- Added stricter smoke checks so cloud and bridge validation also assert manifest context fields, not only terminal replies.

## Remaining Risks

- A live production environment can still pass a basic dispatch check while running an older build that does not carry full manifest context into created commands.
- Cloud reply handling still depends on Slack thread behavior and webhook ingestion consistency; this is narrower than full dispatch failure, but it remains the highest-value production check.
- Release safety depends on keeping these files aligned for any UI ship:
  - `public/version.json`
  - `public/app.js`
  - cache-busting asset URLs in `public/index.html`

## Related Notes

- Context routing audit: [project-context-audit-2026-04-17.md](/Users/andriilitvinov/projects/MYPROJECTS/links/docs/project-context-audit-2026-04-17.md)
