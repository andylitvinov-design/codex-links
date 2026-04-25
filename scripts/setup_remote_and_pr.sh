#!/usr/bin/env bash
set -euo pipefail

OWNER_REPO="${CODEX_GITHUB_REPO:-andylitvinov-design/codex-links}"
ORIGIN_URL="${CODEX_GITHUB_ORIGIN_URL:-https://github.com/${OWNER_REPO}.git}"
BASE_BRANCH="${CODEX_BASE_BRANCH:-main}"
BRANCH_PREFIX="${CODEX_BRANCH_PREFIX:-codex/auto-sync}"
COMMIT_MESSAGE="${AUTO_SYNC_COMMIT_MESSAGE:-chore: auto-sync codex updates}"
PR_TITLE="${AUTO_SYNC_PR_TITLE:-Restore GitHub auto-sync push}"
DEPLOYMENTS_LOG="${DEPLOYMENTS_LOG:-DEPLOYMENTS.md}"

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

redact() {
  sed -E \
    -e 's#(https?://)[^/@[:space:]]+@#\1[redacted]@#g' \
    -e 's#((GITHUB|GH|CODEX|AUTO_SYNC|HTTPS?_PROXY|ALL_PROXY|NO_PROXY)[A-Z0-9_]*=).*#\1[redacted]#Ig' \
    -e 's#(Authorization: Bearer )[A-Za-z0-9._-]+#\1[redacted]#g'
}

append_deployment() {
  local status="$1"
  local branch="$2"
  local pr_url="$3"
  local summary="$4"

  if [ ! -f "$DEPLOYMENTS_LOG" ]; then
    {
      echo "# Deployments"
      echo
      echo "This file is the append-only operator log for GitHub auto-sync attempts."
      echo
      echo "| Timestamp | Status | Branch | PR | Summary |"
      echo "| --- | --- | --- | --- | --- |"
    } >"$DEPLOYMENTS_LOG"
  fi

  printf '| %s | %s | `%s` | %s | %s |\n' \
    "$(timestamp)" "$status" "${branch:-unknown}" "${pr_url:-n/a}" "$summary" >>"$DEPLOYMENTS_LOG"
}

setup_askpass() {
  local token="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
  if [ -z "$token" ]; then
    return 0
  fi

  GIT_ASKPASS_TMP="$(mktemp)"
  cat >"$GIT_ASKPASS_TMP" <<EOF
#!/usr/bin/env sh
case "\$1" in
  *Username*) printf '%s\n' 'x-access-token' ;;
  *) printf '%s\n' '$token' ;;
esac
EOF
  chmod 700 "$GIT_ASKPASS_TMP"
  export GIT_ASKPASS="$GIT_ASKPASS_TMP"
  export GIT_TERMINAL_PROMPT=0
}

cleanup() {
  if [ -n "${GIT_ASKPASS_TMP:-}" ] && [ -f "$GIT_ASKPASS_TMP" ]; then
    rm -f "$GIT_ASKPASS_TMP"
  fi
}
trap cleanup EXIT

run_command() {
  local title="$1"
  shift
  echo "== $title =="
  if "$@" 2>&1 | redact; then
    echo
    return 0
  fi
  local status=$?
  echo "[auto-sync] diagnostic command failed with exit $status: $title"
  echo
  return "$status"
}

run_network_diagnostics() {
  echo "## GitHub network diagnostics"
  run_command "env | rg -i proxy" bash -c "env | rg -i proxy || true" || true
  run_command "git proxy config" bash -c "git config --show-origin --get-regexp 'http\\.(proxy|sslVerify)|https\\.proxy' || true" || true
  run_command "curl https://github.com" curl -Iv -m 10 https://github.com || true
  run_command "curl https://api.github.com" curl -Iv -m 10 https://api.github.com || true
  run_command "ssh git@ssh.github.com:443" bash -c "ssh -T -p 443 -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 git@ssh.github.com || true" || true

  if command -v ip >/dev/null 2>&1; then
    run_command "ip route" ip route || true
  elif command -v route >/dev/null 2>&1; then
    run_command "route github.com" route -n get github.com || true
  fi

  if command -v iptables >/dev/null 2>&1; then
    run_command "iptables rules" bash -c "iptables -S || true" || true
  fi

  if command -v nft >/dev/null 2>&1; then
    run_command "nft ruleset" bash -c "nft list ruleset || true" || true
  fi
}

ensure_origin() {
  if git remote | grep -qx origin; then
    local current_url
    current_url="$(git remote get-url origin)"
    if [ "$current_url" != "$ORIGIN_URL" ]; then
      echo "[auto-sync] origin exists: $current_url"
      echo "[auto-sync] leaving existing origin unchanged; set CODEX_GITHUB_ORIGIN_URL to override in this environment"
    fi
  else
    git remote add origin "$ORIGIN_URL"
    echo "[auto-sync] added origin: $ORIGIN_URL"
  fi
}

ensure_branch() {
  local branch
  branch="$(git branch --show-current || true)"

  if [ -z "$branch" ] || [ "$branch" = "$BASE_BRANCH" ]; then
    branch="${BRANCH_PREFIX}-$(date -u +%Y%m%d-%H%M%S)"
    git switch -c "$branch"
  fi

  printf '%s\n' "$branch"
}

commit_if_needed() {
  if [ -z "$(git status --porcelain)" ]; then
    echo "[auto-sync] no working tree changes to commit"
    return 0
  fi

  git add -A
  git commit -m "$COMMIT_MESSAGE"
}

create_or_find_pr() {
  local branch="$1"
  local body_file
  body_file="$(mktemp)"
  cat >"$body_file" <<EOF
Restores repo-side GitHub auto-sync automation:

- network/proxy diagnostics for GitHub egress
- safe HTTPS push through gh auth or GITHUB_TOKEN/GH_TOKEN
- local outbox sync runner
- cron installer for periodic sync
- append-only deployment attempt log

Secrets are read only from environment variables and are not committed.
EOF

  if ! command -v gh >/dev/null 2>&1; then
    rm -f "$body_file"
    echo ""
    return 0
  fi

  if ! gh auth status >/dev/null 2>&1; then
    rm -f "$body_file"
    echo ""
    return 0
  fi

  local existing_url
  existing_url="$(gh pr view "$branch" --repo "$OWNER_REPO" --json url -q .url 2>/dev/null || true)"
  if [ -n "$existing_url" ]; then
    rm -f "$body_file"
    printf '%s\n' "$existing_url"
    return 0
  fi

  local pr_url
  pr_url="$(gh pr create --repo "$OWNER_REPO" --base "$BASE_BRANCH" --head "$branch" --title "$PR_TITLE" --body-file "$body_file" 2>/dev/null || true)"
  rm -f "$body_file"
  printf '%s\n' "$pr_url"
}

main() {
  setup_askpass
  ensure_origin
  run_network_diagnostics

  if ! git ls-remote --heads origin "$BASE_BRANCH" >/dev/null 2>&1; then
    append_deployment "failed" "$(git branch --show-current || true)" "n/a" "cannot reach origin/${BASE_BRANCH}; check proxy or egress"
    echo "[auto-sync] cannot reach origin/${BASE_BRANCH}; check proxy, egress, and credentials"
    exit 1
  fi

  local branch
  branch="$(ensure_branch)"

  commit_if_needed

  echo "[auto-sync] pushing $branch to origin"
  git push -u origin "$branch"

  local pr_url
  pr_url="$(create_or_find_pr "$branch")"
  if [ -n "$pr_url" ]; then
    append_deployment "success" "$branch" "$pr_url" "push and PR creation confirmed"
    echo "PR_URL=$pr_url"
  else
    append_deployment "success" "$branch" "n/a" "push confirmed; gh unavailable or not authenticated for PR creation"
    echo "[auto-sync] push confirmed; create PR manually for branch $branch"
  fi
}

main "$@"
