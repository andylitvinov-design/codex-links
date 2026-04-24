# Codex Save

Separate Cloudflare Pages operator surface for `codex-links`.

## What It Does

- runs live diagnostics against `https://codex-links.pages.dev`
- classifies each route as `pass`, `degraded`, `fail`, or `blocked`
- starts remediation by creating a real agent command through `codex-links /api/commands`
- runs a post-fix recheck and stores a before/after report

## Local Usage

```bash
npm run save:dev
npm run save:deploy
```

## Required Bindings

- KV namespace bound as `SAVE_STORE`

## Optional Environment Variables

- `CODEX_LINKS_BASE_URL`
- `CODEX_SAVE_TARGET_THREAD_ID`
- `CODEX_SAVE_TARGET_PROJECT_ID`
- `CODEX_SAVE_TARGET_REPO`
- `CODEX_SAVE_TARGET_REPO_URL`
