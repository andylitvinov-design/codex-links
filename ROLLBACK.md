# Codex Links Rollback

## Standard Rollback

1. Create a rollback branch and revert the bad commit:

```bash
node scripts/revert-last-good.mjs --commit <bad-commit-sha> --push
```

2. Open or merge the rollback PR back into `main`.

## Emergency Production Rollback

If the site must recover before the revert PR is merged:

1. In Cloudflare Pages, redeploy the previous known-good `codex-links` deployment.
2. Still merge the Git revert PR so GitHub and production return to the same state.

## Notes

- Never fix production by force-pushing `main`.
- Prefer reverting the merge or the exact bad commit, not editing history.
- If trusted cloud mode is the regression source, first stop the private bridge service or switch Pages `COMMAND_DISPATCH_MODE` back to `local-bridge`, then ship the Git revert through the normal PR flow.
