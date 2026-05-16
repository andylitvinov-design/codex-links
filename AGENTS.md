# Codex Links Repo Rules

Inherit the shared standard from [/Users/andriilitvinov/projects/MYPROJECTS/AGENTS.md](/Users/andriilitvinov/projects/MYPROJECTS/AGENTS.md).

## Repo-Specific Rules

- `codex-links` uses Cloudflare Pages as the production surface.
- GitHub `main` is the only production branch.
- Every production-facing change must land through branch -> PR -> merge -> Pages deploy.
- After a production PR is merged into `main`, deploy it to Cloudflare Pages in the same work session. Do not leave merged UI changes unapplied on the live site.
- Keep the Slack/Codex Cloud flow on branch-and-PR mode only. Never instruct cloud execution to push directly to `main`.
- Keep `public/version.json`, `public/app.js`, and the cache-busting asset URLs in `public/index.html` aligned on each shipped UI change.

## Runtime Boundary Rule

- Before telling the user where to place any credential, first prove the exact process that will consume it.
- Do not assume that a hosting/project environment feeds a local daemon or a separate worker.
- For every integration setup, prove this chain first: storage location -> consuming process -> config reference -> live probe.
- Required evidence before setup instructions: runtime name, where the value is stored, how the runtime receives it, and one command or probe that proves it.
- If the consuming runtime is not proven, write `needs verification` and give a safe fallback path instead of choosing a likely-wrong storage location.
- Example: Cloudflare Pages environment values are scoped to the Cloudflare runtime. A local OpenClaw daemon needs local daemon environment or a runtime that explicitly injects those values into that daemon.
