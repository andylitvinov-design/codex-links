#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${CODEX_AUTO_SYNC_REPO:-$(git rev-parse --show-toplevel)}"
INTERVAL_MINUTES="${CODEX_AUTO_SYNC_INTERVAL_MINUTES:-5}"
LOG_DIR="${CODEX_AUTO_SYNC_LOG_DIR:-$HOME/.codex/logs}"
MARKER_BEGIN="# codex-links-auto-sync begin"
MARKER_END="# codex-links-auto-sync end"

mkdir -p "$LOG_DIR"

if ! [[ "$INTERVAL_MINUTES" =~ ^[0-9]+$ ]] || [ "$INTERVAL_MINUTES" -lt 1 ] || [ "$INTERVAL_MINUTES" -gt 59 ]; then
  echo "[auto-sync] CODEX_AUTO_SYNC_INTERVAL_MINUTES must be an integer from 1 to 59"
  exit 1
fi

tmp_current="$(mktemp)"
tmp_next="$(mktemp)"
trap 'rm -f "$tmp_current" "$tmp_next"' EXIT

crontab -l >"$tmp_current" 2>/dev/null || true

awk -v begin="$MARKER_BEGIN" -v end="$MARKER_END" '
  $0 == begin { skipping = 1; next }
  $0 == end { skipping = 0; next }
  skipping != 1 { print }
' "$tmp_current" >"$tmp_next"

{
  echo "$MARKER_BEGIN"
  echo "*/${INTERVAL_MINUTES} * * * * cd \"$REPO_DIR\" && CODEX_AUTO_SYNC_REPO=\"$REPO_DIR\" scripts/auto_sync_runner.sh >> \"$LOG_DIR/codex-links-auto-sync.cron.log\" 2>&1"
  echo "$MARKER_END"
} >>"$tmp_next"

crontab "$tmp_next"

echo "[auto-sync] installed cron entry:"
echo "$MARKER_BEGIN"
echo "*/${INTERVAL_MINUTES} * * * * cd \"$REPO_DIR\" && CODEX_AUTO_SYNC_REPO=\"$REPO_DIR\" scripts/auto_sync_runner.sh >> \"$LOG_DIR/codex-links-auto-sync.cron.log\" 2>&1"
echo "$MARKER_END"
