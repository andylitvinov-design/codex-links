# Deploy Version Check

This document tells agents how to check the current live deployment version without asking the user.

## Project

```text
Repo: andylitvinov-design/codex-links
Platform: Cloudflare Pages
Production URL: https://codex-links.pages.dev/
Version URL: https://codex-links.pages.dev/version.json
```

## Rule

Agents must check the current live version themselves. Do not ask Andrey to open the site, inspect the deployed version, or run local terminal deploy/check commands when machine-readable checks are available.

## Primary checks

Use:

```text
GET https://codex-links.pages.dev/
GET https://codex-links.pages.dev/version.json
```

The current `version.json` exposes a build marker, not a commit SHA.

Example shape:

```json
{
  "build": "20260516-1306"
}
```

## Expected version comparison

If the task changed `public/version.json`, compare:

```text
expected build marker == live /version.json build marker
```

If the task changed `public/app.js` or UI assets, also check that `public/index.html` cache-busting references were updated and that live HTML/assets reflect the expected version.

## Workflow evidence

The fallback workflow verifies:

```text
expected_sha == actual checked-out SHA
```

and deploys via:

```bash
npm run deploy
```

This proves the workflow deployed the intended checkout. For commit-level live proof, add commit metadata to `version.json` or a separate `build-info.json`.

## If exact live commit cannot be proven

Report:

```text
Production URL and version endpoint respond, but current version.json exposes only a build marker, not commit SHA. I verified the build marker and workflow deploy output; commit-level live proof requires adding commit metadata to version.json or build-info.json.
```

Do not ask the user to check manually.

## Final report block

Every production/deploy-related report must include:

```text
Live version check:
- Production URL: https://codex-links.pages.dev/
- Version URL: https://codex-links.pages.dev/version.json
- Expected SHA:
- Expected build marker:
- Live SHA/build marker:
- Match: yes/no/unknown
- Evidence source: version.json / production URL / GitHub Actions workflow summary
- If unknown, why:
```

## Hard rules

```text
Never ask the user to check the current live version manually.
Never claim commit-level verification when only version.json build marker was checked.
Never claim production is current without checking production URL and version URL.
Always distinguish URL responds vs version marker matches vs commit SHA matches.
```

Cross-project source standard:

```text
andylitvinov-design/active-projects-ops/docs/deploy-version-check-protocol.md
```
