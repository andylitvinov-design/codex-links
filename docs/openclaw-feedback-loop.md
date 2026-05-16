# OpenClaw Feedback Loop

## Scope

The first OpenClaw-backed feedback loop is a read-only verifier for public live site state. It gives ChatGPT/Codex a repeatable command for checking whether known deployment surfaces are reachable and, when a public status endpoint exists, whether the observed live commit matches an expected commit.

This is not unrestricted execution, not a deploy path, and not a production dispatcher.

## Command

```bash
npm run feedback:verify -- --project finance --json
npm run feedback:verify -- --project finance --expected-commit <sha> --json
npm run feedback:verify -- --project reiki-yggdrasil --json
```

Supported flags:

- `--project <key>`: `finance` or `reiki-yggdrasil`; defaults to `finance`
- `--expected-commit <sha>`: optional commit or version to compare against a public status response
- `--live-url <url>`: optional live URL override for the selected project
- `--json`: print only JSON

## Output Contract

The verifier prints compact, non-secret fields:

- `projectKey`
- `liveUrl`
- `expectedCommit`
- `observedCommit`
- `statusEndpoint`
- `liveReachable`
- `versionMatches`
- `checks[]`
- `result`
- `exactFailingCommand`
- `summary`

`result` is one of:

- `pass`: all required live checks passed and, when an expected commit is provided, the live commit matches
- `fail`: a live endpoint failed or the expected commit mismatched a public observed commit
- `needs_verification`: live checks were reachable but no public version signal or no expected commit was available for a version claim

## Supported Projects

### `finance`

Default live URL: [https://ezohata-incoming-ledger.vercel.app](https://ezohata-incoming-ledger.vercel.app)

Checks:

- `GET /api/status`
- parse `commitSha`, `commitRef`, and `status` when available
- `GET /api/audit-snapshot` with timeout and size limit
- summarize audit snapshot only as response status and warning count when available

When `--expected-commit` is provided, `result=pass` requires `commitSha` to match the expected commit by exact match or prefix-compatible match.

### `reiki-yggdrasil`

Default live URL: [https://reiki-yggdrasil.vercel.app](https://reiki-yggdrasil.vercel.app)

Checks:

- `GET /`
- `GET /profile`
- `GET /masters`
- `GET /profile/admin`

The verifier summarizes status codes only. Because there is no known public build version endpoint, `observedCommit` is `needs_verification` and the summary recommends adding `/version.json` or a public status endpoint in that repo.

## Local Checks

Optional local checks can be added later only when a repo checkout path is explicitly passed or safely detected. The allowed local commands are:

- `git status --short`
- `npm test`, only if `package.json` has a `test` script
- `npm run build`, only if `package.json` has a `build` script

The first feedback-loop script does not run local project commands by default and does not install dependencies.

## Future Telemetry

Future delivery timeline or inbox integration should use stable non-secret events after the verifier output contract has settled:

- `openclaw_feedback_check`
- `openclaw_live_verify`
- `openclaw_deploy_verify`

These events are documented only. This PR does not emit events or mutate Codex Links production state.

## Safety Rules

- no secrets or env values
- no `.env` reads
- no deploy
- no merge
- no delete
- no production mutation
- no changes to `functions/api/commands.js` or dispatch architecture
- no OpenClaw default executor
