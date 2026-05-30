# Codex Links Repo Rules

Inherit the shared standard from [/Users/andriilitvinov/projects/MYPROJECTS/AGENTS.md](/Users/andriilitvinov/projects/MYPROJECTS/AGENTS.md).

## Repo-Specific Rules

- `codex-links` uses Cloudflare Pages as the production surface.
- GitHub `main` is the only production branch.
- Every production-facing change must land through branch -> PR -> merge -> Pages deploy.
- After a production PR is merged into `main`, deploy it to Cloudflare Pages in the same work session. Do not leave merged UI changes unapplied on the live site.
- Keep the Slack/Codex Cloud flow on branch-and-PR mode only. Never instruct cloud execution to push directly to `main`.
- Keep `public/version.json`, `public/app.js`, and the cache-busting asset URLs in `public/index.html` aligned on each shipped UI change.

## Cloudflare Pages Deploy Fallback

This repo has a production fallback workflow:

```text
.github/workflows/deploy-production.yml
```

Use it when Cloudflare Pages auto-deploy does not trigger, production remains stale after push/merge, or the user reports that live does not show completed changes.

Do not ask Andrey to run a local terminal deploy until this fallback path has been attempted and diagnosed.

Before fallback deploy, always prove:

```text
Repo: andylitvinov-design/codex-links
Platform: Cloudflare Pages
Target ref: normally main
Expected SHA: known commit SHA
Changes: committed and pushed/merged
Production URL: https://codex-links.pages.dev/
Version URL: https://codex-links.pages.dev/version.json
```

Default command:

```bash
gh workflow run deploy-production.yml \
  --ref main \
  -f ref=main \
  -f expected_sha=<expected_commit_sha> \
  -f reason="fallback deploy after stale production"
```

Hard order:

```text
commit / push / merge first
fallback deploy second
production verification third
```

Never deploy uncommitted or unpushed changes. Never deploy an unknown ref. Never claim production is updated without checking production after deploy.

After workflow completion, verify:

```text
https://codex-links.pages.dev/
https://codex-links.pages.dev/version.json
```

Full local protocol: `docs/deploy-fallback.md`.
Cross-project standard: `andylitvinov-design/active-projects-ops` docs.
