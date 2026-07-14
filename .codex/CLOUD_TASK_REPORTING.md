# Persistent Codex Cloud task reporting

Every Codex Cloud task that reaches `COMPLETED`, `BLOCKED`, `PARTIAL`, or `FAILED` must persist its result in this repository, not only in the Cloud conversation.

Before finishing:
1. Create `.codex/reports/YYYY-MM-DD/<task-slug>.md`.
2. Update `.codex/LATEST.md` with status, findings, real changes, branch, commit/PR, blocker, and next action.
3. Append the task to `.codex/TASKS.md`.
4. Commit these files on the same task branch; when no implementation changed, make a docs-only report commit.
5. Do not mark the task complete until the report is committed and visible in GitHub.

Reports must contain the request, verified findings, changes made, verification, blockers/risks, and one next action. Never include secrets or unverified claims.