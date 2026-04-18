# Codex Links Repo Rules

Inherit the shared standard from [/Users/andriilitvinov/projects/MYPROJECTS/AGENTS.md](/Users/andriilitvinov/projects/MYPROJECTS/AGENTS.md).

## Repo-Specific Rules

- `codex-links` uses Cloudflare Pages as the production surface.
- GitHub `main` is the only production branch.
- Every production-facing change must land through branch -> PR -> merge -> Pages deploy.
- After a production PR is merged into `main`, deploy it to Cloudflare Pages in the same work session. Do not leave merged UI changes unapplied on the live site.
- Keep the Slack/Codex Cloud flow on branch-and-PR mode only. Never instruct cloud execution to push directly to `main`.
- Keep `public/version.json`, `public/app.js`, and the cache-busting asset URLs in `public/index.html` aligned on each shipped UI change.
