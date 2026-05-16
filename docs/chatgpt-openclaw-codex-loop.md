# ChatGPT OpenClaw Codex Approval Loop

## Purpose

ChatGPT needs a controlled way to propose concrete Codex tasks, wait for explicit user approval, route approved work through Codex Links and later OpenClaw, and return the result to a reviewable conversation surface.

The first safe prototype keeps Codex Links as the bridge surface:

1. ChatGPT prepares a structured proposal payload.
2. The user reviews and approves that proposal.
3. Codex Links stores the approval, then a separate explicit dispatch sends the approved task into the existing Codex command path.
4. Codex executes or prepares a PR/result.
5. The result returns to a Codex Links inbox/timeline thread.
6. ChatGPT and the user review the result.
7. Any next step starts as a new proposal and repeats the same approval loop.

This document is a contract plus the safe proposal storage, approval, and explicit dispatch flow. Approval alone does not dispatch real Codex commands.

## Constraint

Directly posting back into the same existing ChatGPT thread is `needs verification`. This repository should not claim that OpenClaw, Codex Links, ChatGPT Actions, or a custom GPT can inject a result into the exact same existing ChatGPT thread until an official supported callback surface is verified.

For now, Codex Links is the bridge surface. ChatGPT can create a proposal payload, Codex Links can store proposal/result records under a stable `threadKey`, and the user or ChatGPT can read/copy the result from the Codex Links inbox/timeline.

## Approval Loop Phases

- `proposal`: ChatGPT creates a concrete task with repo, project, prompt, allowed actions, forbidden actions, and stop conditions.
- `approval`: the user explicitly approves the proposal before any dispatch.
- `dispatch`: a separate authorized request sends only the approved proposal to the existing Codex command path.
- `running`: Codex works under the approved action boundary and reports progress.
- `result`: Codex returns a compact result with changed files, checks, risks, and any exact failing command.
- `review`: the user and ChatGPT review the result in Codex Links.
- `continue`: a next step is proposed as a new approved payload, not as automatic chained execution.

Allowed status values are:

- `proposed`
- `approved`
- `dispatched`
- `running`
- `needs_user_decision`
- `completed`
- `failed`

## Data Contract

The proposal/result object uses these fields:

- `threadKey`: stable Codex Links conversation/timeline key.
- `proposalId`: unique proposal identifier.
- `projectKey`: project routing key, such as `finance` or `reiki-yggdrasil`.
- `repo`: GitHub repo in `owner/name` form, or `null` when it still needs verification.
- `goal`: short outcome the Codex task should accomplish.
- `prompt`: full Codex prompt to send only after approval.
- `allowedActions`: explicit actions Codex may perform.
- `forbiddenActions`: explicit actions Codex must not perform.
- `requiresApproval`: always `true` for generated proposals.
- `status`: one of the allowed approval-loop statuses.
- `codexRunId`: future Codex run identifier, initially `null`.
- `commandId`: Codex Links command id when an approved proposal is explicitly dispatched. The current command lifecycle uses `commandId`; do not infer a fake `codexRunId`.
- `deliveryId`: future Codex Links delivery/timeline identifier, initially `null`.
- `resultSummary`: compact final result text, initially `null`.
- `changedFiles`: exact changed file list, initially empty.
- `checks`: exact checks run and their outcomes, initially empty.
- `exactFailingCommand`: exact failing command when a failure occurs, initially `null`.
- `risks`: known risks or open concerns, initially empty.
- `nextSuggestedPrompt`: optional next prompt for a follow-up proposal, initially `null`.
- `createdAt` and `updatedAt`: ISO timestamps.
- `dryRun`: `true` in this prototype.
- `needsVerification`: additive non-secret list for missing repo, missing prompt, or unknown project key.

## Safety

- Do not automatically merge, deploy, delete, or mutate production.
- Do not read `.env` files.
- Do not print secrets, cookies, tokens, keys, credentials, or environment values.
- Do not perform financial, account, payment, access, or provider-side changes without explicit approval.
- Keep OpenClaw out of production dispatch until gateway health, auth, a safe no-op run, artifacts, timeouts, and telemetry are verified.
- Every Codex run must have a stop condition and a final report.
- Every result must return exact checks, changed files, risks, and exact failing command when applicable.

## Dry Run Command

Generate the built-in example:

```bash
npm run loop:proposal -- --example --json
```

Generate a finance proposal:

```bash
npm run loop:proposal -- \
  --project finance \
  --repo andylitvinov-design/finance \
  --goal "Verify production updated to expected commit" \
  --prompt "Check /api/status and compare expected commit" \
  --json
```

Generate a Reiki proposal:

```bash
npm run loop:proposal -- \
  --project reiki-yggdrasil \
  --repo andylitvinov-design/reiki-yggdrasil \
  --goal "Verify public routes are reachable after deploy" \
  --prompt "Check /, /profile, /masters, /profile/admin" \
  --json
```

The script only creates, validates, and prints a proposal object. It does not dispatch to Codex, OpenClaw, Slack, Cloudflare, or any production service.

## Proposal Storage API

The safe storage layer keeps proposals in Codex Links KV under a stable `threadKey`.

Create a proposed record:

```bash
curl -sS -X POST "https://codex-links.pages.dev/api/proposals" \
  -H "content-type: application/json" \
  -H "x-write-token: $LINKS_WRITE_TOKEN" \
  --data '{"threadKey":"chatgpt-openclaw-codex-loop","projectKey":"finance","repo":"andylitvinov-design/finance","goal":"Verify production updated to expected commit","prompt":"Check /api/status and compare expected commit"}'
```

List proposals for one thread:

```bash
curl -sS "https://codex-links.pages.dev/api/proposals?threadKey=chatgpt-openclaw-codex-loop" \
  -H "x-write-token: $LINKS_WRITE_TOKEN"
```

Read one proposal:

```bash
curl -sS "https://codex-links.pages.dev/api/proposals/proposal-id" \
  -H "x-write-token: $LINKS_WRITE_TOKEN"
```

Approve one proposal:

```bash
curl -sS -X POST "https://codex-links.pages.dev/api/proposals/proposal-id/approve" \
  -H "content-type: application/json" \
  -H "x-write-token: $LINKS_WRITE_TOKEN" \
  --data '{"approvedBy":"operator"}'
```

Approval changes only stored state from `proposed` to `approved`, sets `approvedAt`, optionally stores `approvedBy`, and leaves `commandId`, `codexRunId`, `deliveryId`, and `resultSummary` empty. Stored proposals have `dryRun: true` and `dispatchEnabled: false`.

Approve is not dispatch. It never creates a command and never calls Codex, OpenClaw, Slack, Cloudflare deploy, merge, or delete paths.

Dispatch one approved proposal:

```bash
curl -sS -X POST "https://codex-links.pages.dev/api/proposals/proposal-id/dispatch" \
  -H "x-write-token: $LINKS_WRITE_TOKEN"
```

Dispatch requires the same existing Codex Links write/admin authorization. It loads the approved proposal, builds the approved Codex prompt wrapper, creates a command through the existing Codex command storage/dispatch path, and updates the proposal with:

- `status: dispatched`
- `dispatchedAt`
- `commandId`
- `codexRunId` only when the existing command lifecycle provides one
- `deliveryId` when available from the command/delivery surface
- `dispatchEnabled: true`
- `updatedAt`

If the proposal is missing, dispatch returns `404`. If it is not `approved`, dispatch returns `400`. If it already has `commandId`, `codexRunId`, or `deliveryId`, dispatch is duplicate-safe and returns the existing linked command info instead of dispatching twice.

The dispatched result still returns through the existing Codex Links command and delivery timeline surface. Direct callback into the same existing ChatGPT thread still needs verification and must not be treated as available until an official supported callback surface is proven.

OpenClaw remains readiness/probe-only and is not the default executor. This endpoint does not make OpenClaw an unrestricted executor, does not change production dispatch defaults, and does not bypass the existing command route.

The API requires the existing Codex Links write/admin authorization token. It does not read `.env` files and does not print token values.

## Example Approval To Dispatch Flow

1. Create proposal:

```bash
curl -sS -X POST "https://codex-links.pages.dev/api/proposals" \
  -H "content-type: application/json" \
  -H "x-write-token: $LINKS_WRITE_TOKEN" \
  --data '{"threadKey":"chatgpt-openclaw-codex-loop","projectKey":"finance","repo":"andylitvinov-design/finance","goal":"Verify production updated to expected commit","prompt":"Check /api/status and compare expected commit","allowedActions":["read repo","GET /api/status"],"forbiddenActions":["no secrets/env values","no deploy","no merge"]}'
```

2. Approve proposal:

```bash
curl -sS -X POST "https://codex-links.pages.dev/api/proposals/proposal-id/approve" \
  -H "content-type: application/json" \
  -H "x-write-token: $LINKS_WRITE_TOKEN" \
  --data '{"approvedBy":"operator"}'
```

3. Dispatch approved proposal:

```bash
curl -sS -X POST "https://codex-links.pages.dev/api/proposals/proposal-id/dispatch" \
  -H "x-write-token: $LINKS_WRITE_TOKEN"
```

4. Read result from the existing command/delivery timeline:

```bash
curl -sS "https://codex-links.pages.dev/api/commands?clientId=proposal:proposal-id" \
  -H "x-write-token: $LINKS_WRITE_TOKEN"
```

## Example Proposal Payloads

Finance production verification proposal:

```json
{
  "threadKey": "chatgpt-openclaw-codex-loop",
  "proposalId": "proposal-example-finance",
  "projectKey": "finance",
  "repo": "andylitvinov-design/finance",
  "goal": "verify EzoHata Ledger production version",
  "prompt": "Verify the live EzoHata Ledger production version using /api/status and /api/audit-snapshot. Report exact checks, changed files, risks, and next suggested prompt. Do not deploy or merge.",
  "allowedActions": [
    "read repo",
    "run tests",
    "run build",
    "GET /api/status",
    "GET /api/audit-snapshot"
  ],
  "forbiddenActions": [
    "no secrets/env values",
    "no .env reads",
    "no deploy without explicit approval",
    "no merge without explicit approval",
    "no delete without explicit approval"
  ],
  "requiresApproval": true,
  "status": "proposed"
}
```

Reiki route verification proposal:

```json
{
  "threadKey": "chatgpt-openclaw-codex-loop",
  "proposalId": "proposal-example-reiki-yggdrasil",
  "projectKey": "reiki-yggdrasil",
  "repo": "andylitvinov-design/reiki-yggdrasil",
  "goal": "verify public routes after deploy",
  "prompt": "Verify that /, /profile, /masters, and /profile/admin are reachable. Report statuses, risks, and next suggested prompt. Do not deploy or merge.",
  "allowedActions": [
    "read repo",
    "run build",
    "GET /",
    "GET /profile",
    "GET /masters",
    "GET /profile/admin"
  ],
  "forbiddenActions": [
    "Supabase secret values",
    "no secrets/env values",
    "no .env reads",
    "no deploy without explicit approval",
    "no merge without explicit approval",
    "no delete without explicit approval"
  ],
  "requiresApproval": true,
  "status": "proposed"
}
```

## Example ChatGPT Behavior

ChatGPT prepares a proposal payload and shows it to the user. If the user says "yes" or otherwise explicitly approves it, Codex Links can mark the proposal approved. A separate explicit dispatch request sends the approved proposal to the existing Codex command path. Codex returns the result to the Codex Links command/timeline surface. The user and ChatGPT review that result, then create a new proposal for the next step only if the user approves continuing.

## Future Implementation Steps

1. Add the smallest inbox/timeline UI surface for proposed and approved records under `threadKey`.
2. Normalize Codex results back into proposal records with `resultSummary`, `checks`, `changedFiles`, `risks`, and `nextSuggestedPrompt`.
3. Show a proposal/result thread in the Codex Links UI.
4. Integrate OpenClaw as an experimental executor only after gateway and safe no-op runs are verified.
5. Expose stable non-secret approval-loop telemetry to `brain-management`.
