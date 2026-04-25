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

optional_trusted_cloud_keys=(
  CLOUD_BRIDGE_BASE_URL
  CLOUD_BRIDGE_SHARED_SECRET
  CLOUD_BRIDGE_LABEL
  CLOUD_BRIDGE_REQUEST_TIMEOUT_MS
)

for key in "${optional_trusted_cloud_keys[@]}"; do
  value="$(extract_value "$key")"

  if [[ -z "$value" ]]; then
    continue
  fi

  echo "Uploading optional trusted-cloud key $key to Pages project $PROJECT_NAME"
  printf "%s" "$value" | npx wrangler pages secret put "$key" --project-name "$PROJECT_NAME"
done

optional_slack_keys=(
  SLACK_BOT_TOKEN
  SLACK_CODEX_DISPATCH_TOKEN
  SLACK_SIGNING_SECRET
  SLACK_CODEX_CHANNEL_ID
  SLACK_CODEX_USER_ID
  SLACK_CODEX_MENTION
  SLACK_ACTOR_ACTIVITY_FRESHNESS_MS
  SLACK_ACTOR_LIVE_PROBE
  SLACK_ACTOR_PROBE_TIMEOUT_MS
  SLACK_ACTOR_PROBE_POLL_MS
  SLACK_ACTOR_PROBE_COOLDOWN_MS
)

for key in "${optional_slack_keys[@]}"; do
  value="$(extract_value "$key")"

  if [[ -z "$value" ]]; then
    continue
  fi

  echo "Uploading optional legacy key $key to Pages project $PROJECT_NAME"
  printf "%s" "$value" | npx wrangler pages secret put "$key" --project-name "$PROJECT_NAME"
done

openai_api_key="$(extract_value OPENAI_API_KEY)"
dispatch_mode="$(extract_value COMMAND_DISPATCH_MODE)"

if [[ -n "$openai_api_key" ]]; then
  echo "Uploading optional direct OpenAI key OPENAI_API_KEY to Pages project $PROJECT_NAME"
  printf "%s" "$openai_api_key" | npx wrangler pages secret put OPENAI_API_KEY --project-name "$PROJECT_NAME"
elif [[ "$dispatch_mode" == "direct-openai" || "$dispatch_mode" == "cloud" ]]; then
  echo "Missing OPENAI_API_KEY in $ENV_FILE for direct OpenAI dispatch mode" >&2
  exit 1
else
  echo "OPENAI_API_KEY not set; direct OpenAI will remain unavailable."
fi

echo ""
echo "Secrets uploaded. Verify production mode:"
echo "  npm run cloud:check"
