# Codex Project Routing Contract

This document defines the project-bound routing contract for `codex-links`.

The goal is to stop treating Codex delivery as a generic cloud queue and make every command traceable to a concrete project, repository, and Codex Cloud environment.

## Target flow

```text
UI / Slack / API command
  -> projectKey
  -> project dispatch manifest
  -> repo + Codex environment metadata
  -> executor dispatch
  -> terminal result or honest failure stage
  -> command timeline
```

A command is not successful just because it has a cloud job/thread/message ID. A command is successful only when it has all of the following:

- `projectKey`
- target `repo`
- Codex environment name or ID
- executor route / dispatch mode
- terminal status
- final answer, result URL, PR URL, or explicit failure stage

## Source of truth

The project registry is currently `functions/_lib/project-dispatch-manifest.js`.

Each cloud-routable project should define:

```js
{
  id: "reiki-yggdrasil",
  label: "reiki yggdrasil",
  targetRepo: "andylitvinov-design/reiki-yggdrasil",
  targetRepoUrl: "https://github.com/andylitvinov-design/reiki-yggdrasil",
  aliases: ["reiki", "yggdrasil"],
  contextFiles: ["AGENTS.md", "README.md", "STATE.md"],
  codexCloud: {
    environmentName: "reiki-yggdrasil",
    environmentId: "needs-verification",
    defaultBranch: "main",
    dispatchMode: "cloud-via-slack",
    allowedActions: ["audit", "fix", "test", "design-check"]
  },
  visible: true,
  cloudReady: true
}
```

Do not invent `environmentId` values. Keep `environmentId: "needs-verification"` until the exact ID is copied from the Codex Cloud settings or from an authenticated Codex CLI cloud config.

## Required command fields

Every command should preserve these fields once project routing is resolved:

- `id` / `commandId`
- `projectKey`
- `projectId`
- `projectLabel`
- `targetRepo`
- `targetRepoUrl`
- `targetContextFiles`
- `targetWorkspacePath`
- `codexEnvironmentName`
- `codexEnvironmentId`
- `codexEnvironmentVerified`
- `defaultBranch`
- `allowedActions`
- `dispatchMode`
- `requestedExecutor`
- `actualExecutor`
- `status`
- `progressStage`
- `cloudJobId` / `cloudTaskId` / Slack thread metadata, depending on executor
- `finalAnswer` or assistant message
- `resultUrl` / `prUrl` / `branchName`, when available
- `lastDiagnosticCode`
- `lastDiagnosticDetail`
- `errorMessage`

## Validation rules

Hard error:

- unknown `projectKey`
- project is not visible
- cloud dispatch requested but no target repo is confirmed
- production-changing task has no deploy metadata when production verification is required

Setup-needed / manual step:

- `codexEnvironmentId` is `needs-verification`
- Codex Cloud executor is not able to launch a task into a specific environment

The app may still dispatch through the existing Slack-backed route, but it must keep project metadata on the command so the user can see what project was intended.

## Completion contract

Do not mark a command as `answered` / `completed` just because dispatch succeeded.

Allowed terminal outcomes:

- `answered`: final assistant answer was captured and mirrored to the command timeline
- `failed`: executor returned a terminal failure
- `setup-needed`: routing metadata is valid, but environment selection or deployment verification needs manual setup

Non-terminal outcomes:

- `queued`
- `dispatched`
- `processing`

If there is a Slack thread, cloud job ID, or task ID but no final answer, the command is still non-terminal.

## How to add a new project

1. Add a project entry to `PROJECT_DISPATCH_MANIFEST.projects`.
2. Set `id` to the stable `projectKey` used by UI/API.
3. Set `targetRepo` to `owner/name`.
4. Add `aliases` for common user names.
5. Add `contextFiles` so Codex starts with the right memory.
6. Add `codexCloud.environmentName`.
7. Keep `codexCloud.environmentId = "needs-verification"` until verified.
8. Add deploy metadata if production verification is expected.
9. Add or update tests for `findProjectTargetById` and `resolveProjectDispatchTarget`.

## Smoke checks

Local checks:

```bash
npm test
npm run cloud:check
npm run cloud:smoke -- --project reiki-yggdrasil
```

If a script does not support `--project` yet, that is the next runtime integration task.

API/UI checks after deployment:

- `/api/status` should expose current dispatch mode and last error.
- command details should show project metadata.
- a Reiki command should resolve to `andylitvinov-design/reiki-yggdrasil`.
- a finance command should resolve to `andylitvinov-design/finance`.
- an unknown project should fail before dispatch.

## Current limitation

This repo can define and validate routing metadata now. Exact Codex Cloud environment execution still needs verification in the real runtime because it depends on the connected Codex account, environment IDs, and the executor path available on the machine/server that launches Codex work.
