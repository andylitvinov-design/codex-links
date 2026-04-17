#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PROJECT_NAME="${PROJECT_NAME:-codex-links}"
ENV_FILE="${ENV_FILE:-.dev.vars}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy .dev.vars.example first." >&2
  exit 1
fi

typeset -a required_keys
required_keys=(
  LINKS_WRITE_TOKEN
  COMMAND_DISPATCH_MODE
  GITHUB_OWNER
  GITHUB_TOKEN
  SLACK_BOT_TOKEN
  SLACK_SIGNING_SECRET
  SLACK_CODEX_CHANNEL_ID
  SLACK_CODEX_USER_ID
)

extract_value() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
  echo "${line#*=}"
}

for key in "${required_keys[@]}"; do
  value="$(extract_value "$key")"

  if [[ -z "$value" ]]; then
    echo "Missing $key in $ENV_FILE" >&2
    exit 1
  fi

  echo "Uploading $key to Pages project $PROJECT_NAME"
  printf "%s" "$value" | npx wrangler pages secret put "$key" --project-name "$PROJECT_NAME"
done

optional_mention="$(extract_value SLACK_CODEX_MENTION)"

if [[ -n "$optional_mention" ]]; then
  echo "Uploading SLACK_CODEX_MENTION to Pages project $PROJECT_NAME"
  printf "%s" "$optional_mention" | npx wrangler pages secret put SLACK_CODEX_MENTION --project-name "$PROJECT_NAME"
fi

echo ""
echo "Secrets uploaded. Verify production mode:"
echo "  npm run cloud:check"
