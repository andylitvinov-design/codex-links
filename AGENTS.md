# Global Autonomous Project Rules

Before working in this repository, read and apply the shared project-brain rules:

- `https://raw.githubusercontent.com/andylitvinov-design/ai-projects-brain/main/systems/autonomous-project-executor.md`
- `https://raw.githubusercontent.com/andylitvinov-design/ai-projects-brain/main/systems/agent-rules.md`
- `https://raw.githubusercontent.com/andylitvinov-design/ai-projects-brain/main/systems/codex-project-workflow.md`
- `https://raw.githubusercontent.com/andylitvinov-design/ai-projects-brain/main/projects/codex-links/PROJECT.md`

Default mode: work autonomously for safe read-only, docs, diagnosis, planning, branch, patch, test, and PR work. Ask only before risky actions: secrets/env changes, deletion, merge to `main`, production deploy, financial/account/access changes, irreversible changes, or broad rewrites.

---

# Codex Links Repo Rules

Inherit the shared standard from [/Users/andriilitvinov/projects/MYPROJECTS/AGENTS.md](/Users/andriilitvinov/projects/MYPROJECTS/AGENTS.md).

## Repo-Specific Rules

- `codex-links` uses Cloudflare Pages as the production surface.
- GitHub `main` is the only production branch.
- Every production-facing change must land through branch -> PR -> merge -> Pages deploy.
- After a production PR is merged into `main`, deploy it to Cloudflare Pages in the same work session. Do not leave merged UI changes unapplied on the live site.
- Keep the Slack/Codex Cloud flow on branch-and-PR mode only. Never instruct cloud execution to push directly to `main`.
- Keep `public/version.json`, `public/app.js`, and the cache-busting asset URLs in `public/index.html` aligned on each shipped UI change.
