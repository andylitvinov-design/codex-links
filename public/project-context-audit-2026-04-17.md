# Project Context Audit — 2026-04-17

Latest saved summary of the project-context routing work in `codex-links`.

## Goal

Make project context load correctly for both:

- `Codex Cloud via Slack`
- `Bridge`

and keep the required root system files available in the target GitHub repo/workspace for that context.

## What Was Verified

### Codex Cloud

- selected project is resolved from `project-dispatch-manifest`
- command payload stores:
  - `projectId`
  - `projectLabel`
  - `projectCategory`
  - `targetRepo`
  - `targetRepoUrl`
  - `targetContextFiles`
  - `targetWorkspacePath`
- Slack prompt explicitly includes:
  - project identity
  - repository boundary
  - workspace path
  - ordered context files
  - branch -> PR rule

### Bridge

- bridge now builds a project-scoped prompt instead of forwarding only raw user text
- bridge prompt now includes:
  - project identity
  - repository boundary
  - workspace path
  - ordered project context files
  - instruction to stay inside the selected project boundary

## System Files Check

Cloud-ready projects checked:

- `links`
- `artefacts`
- `management`

Required root files:

- `AGENTS.md`
- `README.md`
- `STATE.md`

Result:

- `links`: complete
- `artefacts`: complete
- `management`: fixed during this task by adding missing `README.md` and `STATE.md`

## Files Changed

Main routing/context work:

- `functions/_lib/project-dispatch-manifest.js`
- `functions/api/commands.js`
- `functions/_lib/slack.js`
- `scripts/bridge-codex-commands.mjs`

Saved context files for `management`:

- `/Users/andriilitvinov/projects/brain/management/README.md`
- `/Users/andriilitvinov/projects/brain/management/STATE.md`

## Validation Run

Checked locally:

- `node --check functions/_lib/project-dispatch-manifest.js`
- `node --check scripts/bridge-codex-commands.mjs`
- cloud-ready repo root file presence for `links`, `artefacts`, `management`

## Return Point

If you need to resume this topic later, start from:

1. this file
2. `README.md`
3. `STATE.md`

Online static copy after deploy:

- `/project-context-audit-2026-04-17.md`
