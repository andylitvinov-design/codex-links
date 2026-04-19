#!/bin/zsh
set -euo pipefail

CONFIG_PATH="${CLOUDFLARE_TUNNEL_CONFIG:-${PWD}/ops/cloudflared-bridge.yml}"
TUNNEL_NAME="${CLOUDFLARE_TUNNEL_NAME:-}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is required to run the named bridge tunnel." >&2
  exit 1
fi

if [[ ! -f "${CONFIG_PATH}" ]]; then
  echo "Missing named tunnel config at ${CONFIG_PATH}" >&2
  exit 1
fi

if [[ -z "${TUNNEL_NAME}" ]]; then
  echo "Set CLOUDFLARE_TUNNEL_NAME to the named tunnel you want to run." >&2
  exit 1
fi

exec cloudflared tunnel --config "${CONFIG_PATH}" run "${TUNNEL_NAME}"
