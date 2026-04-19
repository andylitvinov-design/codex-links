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

## 2026-04-18 Delivery Simplification Follow-Up

Root cause confirmed in code:

- `recoverStaleCommands()` used `Promise.all` over two full-array KV rewrites, so last-write-wins races were built in.
- `POST /api/commands` mutated unrelated old commands before inserting the new one.
- `GET /api/commands` and `GET /api/status` were changing command state during UI polling.
- Slack unmatched reply fallback preferred the newest command instead of the oldest still-unmatched one.
- ack and result were conflated, so timeout evaluation could switch executors while the original one was still active.

Rules now enforced in repo code:

- create path is `validate -> resolve target -> insert -> dispatch once -> return`
- GET paths are observational only
- Slack webhook is the primary cloud ingestion path
- maintenance moved to `/api/admin/commands-maintenance`
- one command gets at most one fallback
- after fallback, executor is final for that command
- UI now shows requested executor, actual executor, and fallback reason separately

## 2026-04-17 Production Follow-Up: Slack Cloud And Photo Delivery

### Newly confirmed errors

- `cloud` requests from the site were still reaching `Direct OpenAI cloud` instead of the intended `Codex Cloud via Slack` path because `slack-codex-cloud` had been collapsed into the same dispatch mode as `cloud`.
- Bridge claim timeout was too aggressive for real delivery conditions:
  - fast watchdog path used `3s`
  - maintenance path used a different threshold
  - result: healthy bridge work could be switched away before claim/ack stabilized
- `cloud + photo` failed after Slack thread creation with:
  - code: `slack_photo_upload_failed`
  - detail: `missing_scope`
  - result: command fell back to local bridge
- `cloud` smoke could produce false positives because the probe looked for `OK` in the whole Slack thread and matched the root task text itself.
- Even after routing was fixed, `cloud via Slack` could still fall back to bridge if Codex did not send a fast enough first acknowledgement in the Slack thread.

### Fixes landed

- Distinct dispatch modes were restored:
  - `cloud` = direct OpenAI cloud
  - `slack-codex-cloud` = Codex Cloud via Slack
- Request routing now prefers `slack-codex-cloud` when the UI asks for cloud and Slack dispatch is configured.
- Bridge fast-claim timeout was increased to reduce premature fallback.
- Smoke coverage now includes:
  - `bridge` text
  - `bridge` photo
  - `cloud` text
  - `cloud` photo
- Slack app manifest now requests `files:write` so threaded file upload is represented in source control.

### Production state after merge

- PR merged: `#26` `Restore Slack cloud routing and photo smoke coverage`
- `main` contains the routing fix
- production build updated to:
  - `public/version.json` -> `20260417-1910`
- remaining external blocker:
  - Slack app must be reinstalled after adding `files:write`

### Remaining operational blockers

- `cloud via Slack` is not yet reliable enough to stay on cloud for all text commands because the current first-ack watchdog can still reroute to bridge before Slack-thread acknowledgement arrives.
- `cloud + photo` will not complete until the Slack app is reauthorized with the new scope set.

### Recommended next actions

1. Reinstall the Slack app after adding `files:write`.
2. Re-run:
   - `npm run cloud:smoke`
   - `npm run cloud:photo-smoke`
3. If text tasks still bounce to bridge, extend or redesign the `cloud via Slack` first-ack watchdog.
4. Keep using bridge as the safe photo fallback until Slack reinstall is complete and verified.

## 2026-04-17 Post-Reinstall Verification

After Slack app reinstall with `files:write`:

- `cloud + text` reached `slack-codex-cloud` successfully and the probe returned into the Codex thread, which confirms end-to-end delivery to Codex Cloud.
- `cloud + photo` reached `slack-codex-cloud` and no longer failed with `missing_scope`.
- remaining problem was unchanged watchdog behavior:
  - both text and photo were moved to `local-bridge`
  - fallback reason stayed `No first executor acknowledgement was observed within the fast cloud first-ack window.`

Updated interpretation:

- Slack scope issue is resolved.
- The current highest-priority blocker is no longer Slack file permission.
- The current highest-priority blocker is the `cloud via Slack` first-ack timeout policy.

## 2026-04-17 Routing Simplification Decision

New rule accepted for the product:

- if `Bridge` is selected in the app:
  - dispatch starts on local bridge
  - if bridge hangs, task may be rerouted to cloud
- if `Bridge` is not selected:
  - dispatch is cloud-only
  - cloud tasks must not auto-fallback back into bridge

New error knowledge recorded:

- `cloud -> bridge` fallback was making cloud-selected tasks look successful while silently switching executors, which hid the real cloud-worker failure mode.
- after Slack scope fix, the remaining cloud-photo blocker was no longer `missing_scope`; the remaining issue became:
  - Slack thread is created
  - but the external Codex/Slack worker still does not respond in-thread in time
- photo delivery to Slack cloud needs stronger worker prompting than “file exists in thread” alone.

New fixes prepared:

- removed automatic `cloud -> bridge` fallback for Slack-cloud execution
- kept `bridge -> cloud` fallback for stalled bridge commands
- after Slack photo upload, the app now posts an explicit thread nudge with the uploaded file reference and asks Codex to acknowledge in the same thread

## 2026-04-17 Slack Photo Upload Argument Fix

Newly confirmed error knowledge:

- after Slack app reinstall and `files:write`, `cloud + photo` no longer failed with `missing_scope`
- the next confirmed blocker for `cloud + photo` became:
  - code: `slack_photo_upload_failed`
  - detail: `invalid_arguments`
- most likely cause in app code:
  - the photo handoff used Slack external upload completion with thread-oriented arguments that Slack rejected
  - result: image never became available to the Codex cloud worker even though thread creation succeeded

Fix prepared:

- simplify Slack photo handoff:
  - complete external upload into the channel
  - do not rely on thread-specific completion arguments during `files.completeUploadExternal`
  - then post an explicit thread reply with the uploaded file permalink and instructions for Codex to read the image in the same thread

Product rule retained:

- `Bridge` selected:
  - start on bridge
  - fallback to cloud only if bridge stalls
- `Bridge` not selected:
  - run cloud-only
  - do not auto-fallback back into bridge, so cloud-worker failures stay visible

## Related Notes

- Context routing audit: [project-context-audit-2026-04-17.md](/Users/andriilitvinov/projects/MYPROJECTS/links/docs/project-context-audit-2026-04-17.md)

## 2026-04-18 Photo Delivery Incident And Fix

### Confirmed root cause

- Photo reading itself did not disappear from Codex.
- The live failure sat between bridge execution and reply finalization.
- The unstable segment was the ephemeral photo run launched from the Node bridge process:
  - direct local `codex exec -i` on the same image succeeded;
  - the launchd bridge could still leave photo commands in `waiting-for-codex` or close them without a durable assistant reply;
  - stale photo commands could also be re-routed back toward Slack even though Slack is not the safe executor for photo recovery.

### Why it looked like Codex stopped reading photos

- At `10:51`, the bridge photo run both read the image and saved the answer in time.
- Later failures were race/runtime failures after image read started:
  - assistant reply was not durably synced in time, or
  - the bridge worker stalled in the ephemeral photo execution path, or
  - stale photo commands were requeued instead of being terminally resolved.
- Yellow processing cards only exposed this more honestly; they were not the cause.

### Fix applied

- Moved ephemeral photo execution off the Node child-process path into a dedicated Python runner script.
- Kept photo prompts on the bridge photo-only prompt path.
- Prevented stale photo commands from falling back to Slack.
- Required command finalization only after assistant reply sync.
- Revalidated live with two real photo smokes:
  - `4113f59d-9aa5-45ad-9e5b-4cb107ee748c` requested `cloud`, auto-routed to `bridge`, finished `answered`
  - `79bcae9d-b1b2-49b8-98aa-f34a37f4457a` requested `bridge`, finished `answered`

### Saved stable point

- Live rollback point saved: production build `20260418-1518`
- App notification sent with working-state confirmation and version anchor
