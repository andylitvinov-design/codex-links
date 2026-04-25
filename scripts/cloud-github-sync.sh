#!/usr/bin/env bash
set -euo pipefail

msg="${1:-chore: sync from Cloud Code}"
token="${GITHUB_TOKEN:-${GH_TOKEN:-}}"

cleanup() {
  if [ -n "${GIT_ASKPASS_TMP:-}" ] && [ -f "$GIT_ASKPASS_TMP" ]; then
    rm -f "$GIT_ASKPASS_TMP"
  fi
}
trap cleanup EXIT

if [ -n "$token" ]; then
  GIT_ASKPASS_TMP="$(mktemp)"
  cat >"$GIT_ASKPASS_TMP" <<EOF
#!/usr/bin/env sh
if [ "\$1" = "Username for 'https://github.com': " ]; then
  echo "x-access-token"
else
  echo "$token"
fi
EOF
  chmod +x "$GIT_ASKPASS_TMP"
  export GIT_ASKPASS="$GIT_ASKPASS_TMP"
  export GIT_TERMINAL_PROMPT=0
fi

if ! git remote | grep -qx 'origin'; then
  echo "[codex-links-sync] No git remote 'origin'. Add it first:"
  echo "[codex-links-sync]   git remote add origin https://github.com/andylitvinov-design/codex-links.git"
  exit 1
fi

branch="$(git branch --show-current)"
if [ -z "$branch" ]; then
  echo "[codex-links-sync] Detached HEAD detected. Checking out main first."
  git checkout main
  branch="main"
fi

if [ "$branch" = "main" ]; then
  base_branch="main"
else
  base_branch="$branch"
fi

if [ "$branch" = "main" ]; then
  branch="codex-links/auto-sync-$(date +%Y%m%d-%H%M%S)"
  echo "[codex-links-sync] You are on main; switching to feature branch $branch"
  git checkout -b "$branch"
fi

if git ls-remote --exit-code --heads origin "$base_branch" >/dev/null 2>&1; then
  echo "[codex-links-sync] Rebase onto origin/$base_branch with autostash"
  git pull --rebase --autostash origin "$base_branch"
else
  echo "[codex-links-sync] Origin branch origin/$base_branch not found; syncing against origin/main"
  git pull --rebase --autostash origin main
fi

if ! git ls-remote --exit-code origin >/dev/null 2>&1; then
  echo "[codex-links-sync] Cannot reach origin or authenticate."
  if [ -n "${token}" ]; then
    echo "[codex-links-sync] Token provided, but auth still failed. Verify token validity and repo scope."
  else
    echo "[codex-links-sync] Set GITHUB_TOKEN (repo scope) before retry."
  fi
  exit 1
fi

if [ -z "$(git status --porcelain)" ]; then
  echo "[codex-links-sync] No changes to sync."
  exit 0
fi

git add -A
git commit -m "$msg"

if ! push_output="$(git push -u origin "$branch" 2>&1)"; then
  echo "$push_output"
  if printf '%s\n' "$push_output" | grep -q "403"; then
    echo "[codex-links-sync] Push failed with 403. Check token scope for repo access."
    if [ -z "${token}" ]; then
      echo "[codex-links-sync] In Cloud Code container, pass token: export GITHUB_TOKEN=<repo-scoped PAT>"
    else
      echo "[codex-links-sync] Ensure token is valid and has repo scope."
    fi
  fi
  exit 1
fi

echo "[codex-links-sync] Pushed branch: $branch"

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  if gh pr view --json number >/dev/null 2>&1; then
    echo "[codex-links-sync] PR already exists for this branch."
  else
    echo "[codex-links-sync] Open PR:
      gh pr create --fill --base main --head $branch"
  fi
else
  echo "[codex-links-sync] GitHub CLI not logged in; push succeeded."
fi
