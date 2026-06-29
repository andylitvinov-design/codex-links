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

## Agent memory router

Before `/delivery`, `/audit`, `/save`, `/memory`, `/memory-review`, `/learn-pass`, or `/upgrade`:

1. Read `agent-memory/active.md`.
2. Read `agent-memory/index.md`.
3. Identify task scope.
4. Read only relevant topic/component files.
5. Do not load archive unless resolving conflicts or running `/memory-review`.
6. Do not load candidates/metrics unless running `/learn-pass`, `/memory-review`, or `/upgrade`.
7. Do not load harness proposals/tests unless running `/upgrade`.

For `/save`, use `.codex/skills/save/SKILL.md` if present.
For `/memory`, use `.codex/skills/memory/SKILL.md` if present.
For `/memory-review`, use `.codex/skills/memory-review/SKILL.md` if present.
For `/learn-pass`, use `.codex/skills/learn-pass/SKILL.md` if present.
For `/upgrade`, use `.codex/skills/upgrade/SKILL.md` if present.

Do not load the whole instruction tree by default.
