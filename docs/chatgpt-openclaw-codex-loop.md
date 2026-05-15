# ChatGPT OpenClaw Codex Approval Loop

## Purpose

ChatGPT needs a controlled way to propose concrete Codex tasks, wait for explicit user approval, route approved work through Codex Links and later OpenClaw, and return the result to a reviewable conversation surface.

The first safe prototype keeps Codex Links as the bridge surface:

1. ChatGPT prepares a structured proposal payload.
2. The user reviews and approves that proposal.
3. A future Codex Links bridge stores and dispatches the approved task.
4. Codex executes or prepares a PR/result.
5. The result returns to a Codex Links inbox/timeline thread.
6. ChatGPT and the user review the result.
7. Any next step starts as a new proposal and repeats the same approval loop.

This document is a contract and dry-run prototype only. It does not dispatch real Codex commands.

## Constraint

Directly posting back into the same existing ChatGPT thread is `needs verification`. This repository should not claim that OpenClaw, Codex Links, ChatGPT Actions, or a custom GPT can inject a result into the exact same existing ChatGPT thread until an official supported callback surface is verified.

For now, Codex Links is the bridge surface. ChatGPT can create a proposal payload, Codex Links can store proposal/result records under a stable `threadKey`, and the user or ChatGPT can read/copy the result from the Codex Links inbox/timeline.

## Approval Loop Phases

- `proposal`: ChatGPT creates a concrete task with repo, project, prompt, allowed actions, forbidden actions, and stop conditions.
- `approval`: the user explicitly approves the proposal before any dispatch.
- `dispatch`: a future bridge sends only the approved proposal to the existing Codex command path.
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

ChatGPT prepares a proposal payload and shows it to the user. If the user says "yes" or otherwise explicitly approves it, a future bridge can mark the proposal approved and send it to Codex. Codex returns the result to the Codex Links timeline. The user and ChatGPT review that result, then create a new proposal for the next step only if the user approves continuing.

## Future Implementation Steps

1. Connect proposal storage to the Codex Links inbox/timeline under `threadKey`.
2. Add an approval endpoint and small UI control for approving a proposed payload.
3. Route approved proposals into the existing Codex command path without changing the production default executor.
4. Normalize Codex results into `resultSummary`, `checks`, `changedFiles`, `risks`, and `nextSuggestedPrompt`.
5. Integrate OpenClaw as an experimental executor only after gateway and safe no-op runs are verified.
6. Expose stable non-secret approval-loop telemetry to `brain-management`.
