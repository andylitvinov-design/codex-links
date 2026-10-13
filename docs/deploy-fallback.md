# Deploy Fallback

This project uses GitHub Actions as a fallback production deploy path for Cloudflare Pages.

## Why

If Cloudflare Pages auto-deploy does not trigger or production remains stale after merge/push, agents must use this workflow before asking the user to run any local terminal deploy.

Production URL:

```text
https://codex-links.pages.dev/
```

Version URL:

```text
https://codex-links.pages.dev/version.json
```

Workflow:

```text
.github/workflows/deploy-production.yml
```

## Platform

This project is not Vercel-backed. It uses Cloudflare Pages.

Deploy command:

```bash
npm run deploy
```

Which maps to:

```bash
wrangler pages deploy public --project-name codex-links
```

## Live version self-check

Before and after fallback deploy, agents must check the current live version themselves.

Local protocol:

```text
docs/deploy-version-check.md
```

For this project, the primary live marker is:

```text
GET https://codex-links.pages.dev/version.json
```

Current `version.json` exposes a build marker, not a commit SHA. Agents must distinguish:

```text
version marker proof != commit-level live proof
```

Agents must check production URL, version URL, workflow output and relevant public asset markers themselves. Do not ask Andrey to check the current live version manually.

## When to use

Use fallback deploy when:

```text
1. The intended commit is already committed and pushed.
2. The intended production ref is known, normally main.
3. Production is stale after push/merge.
4. Cloudflare Pages auto-deploy did not start, failed, or deployed the wrong commit.
5. The user says live does not show the completed changes.
6. public/version.json, public/app.js, or public/index.html cache-busting changes need to be applied to live.
```

## When not to use

Do not use fallback deploy when:

```text
1. Changes are uncommitted.
2. Changes are only local and not pushed.
3. The target ref/commit is unknown.
4. npm test fails.
5. Production already serves the expected version.
6. There is a risk of deploying an old ref over a newer production build.
```

## Hardened fallback gates

The manual workflow accepts only `ref=main`, requires a full 40-character
`expected_sha`, and must itself run from `main`. It fails closed when the current
remote `main` differs from that SHA, including a second check just before deploy.
Merge the reviewed workflow/helper changes first; then use the resulting current
`main` SHA. This workflow has no push, schedule, or automatic deployment trigger.

Application tests run in a separate job without provider credentials, using the
same clean environment and loopback-only network isolation as Validate. The
fresh deployment job installs the lockfile with lifecycle scripts disabled. Only
the explicit Wrangler deployment step receives the existing Cloudflare secrets.
The patch does not create, inspect, replace, or expand those credentials.

The post-deploy verifier reads only `/version.json`, `/app.js`, and `/` on the
fixed Pages production origin. It checks the expected build, all release markers,
and exact static-file bytes against the checked-out source, with bounded retries
for propagation. `/` is used because Pages canonicalizes `/index.html`. No
application JavaScript is executed and no delivery/inbox/KV API is queried.
Static proof does not independently prove the server-function commit or KV health.
A missing secret, failed check, stale SHA, or version mismatch fails the workflow.

## Required GitHub Secrets

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

These secrets must exist in the GitHub repository settings. Do not commit secrets to the repository and do not paste them into chat.

## Standard command

```bash
gh workflow run deploy-production.yml \
  --ref main \
  -f ref=main \
  -f expected_sha=<expected_commit_sha> \
  -f reason="fallback deploy after stale production"
```

Then watch the run:

```bash
gh run list --workflow deploy-production.yml --limit 5
gh run watch <run-id>
```

## Agent protocol

Before fallback deploy:

```text
1. Identify repo.
2. Identify target ref, normally main.
3. Identify expected commit SHA.
4. Confirm changes are committed and pushed.
5. Check production URL and version URL.
6. Compare live version marker with expected build marker when available.
7. If production is stale, trigger deploy-production.yml.
```

After fallback deploy:

```text
1. Re-check https://codex-links.pages.dev/.
2. Re-check https://codex-links.pages.dev/version.json.
3. Verify changed public assets if the task touched UI.
4. Report workflow result and live verification.
5. If exact live commit cannot be proven, state that commit-level proof requires commit metadata in version.json or build-info.json.
```

## Hard rules

```text
commit / push / merge first
fallback deploy second
production verification third
```

Never ask the user to run local deployment until this fallback workflow has been attempted and diagnosed.

Never ask the user to check the current live version manually when production/version URLs are available.

Never run fallback deploy until the target commit is committed, pushed and identified.

Never claim production is updated without checking production after deploy.

Never claim commit-level live verification for this project until version/build-info metadata exposes commit SHA.

## Minimal final report

```text
Repo:
Platform:
Target ref:
Expected SHA:
Workflow:
Run status:
Production URL:
Version URL:
Live status:
Remaining issue:
```

Every deploy-related report must also include:

```text
Live version check:
- Production URL:
- Version URL:
- Expected SHA:
- Expected build marker:
- Live SHA/build marker:
- Match: yes/no/unknown
- Evidence source:
- If unknown, why:
```

## Source standard

Cross-project standard lives in:

```text
andylitvinov-design/active-projects-ops
```

Relevant docs:

```text
docs/github-actions-vercel-deploy-fallback-plan.md
docs/deploy-fallback-agent-autodeploy-protocol.md
docs/deploy-fallback-branch-propagation-policy.md
docs/deploy-version-check-protocol.md
```
