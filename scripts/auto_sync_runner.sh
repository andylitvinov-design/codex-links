#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${CODEX_AUTO_SYNC_REPO:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
LOG_DIR="${CODEX_AUTO_SYNC_LOG_DIR:-$HOME/.codex/logs}"
LOCK_DIR="${TMPDIR:-/tmp}/codex-links-auto-sync.lock"

mkdir -p "$LOG_DIR"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [auto-sync] another run is active"
  exit 0
fi

cleanup() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT

cd "$REPO_DIR"

{
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [auto-sync] runner started in $REPO_DIR"
  scripts/sync_outbox.sh
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [auto-sync] runner finished"
} 2>&1 | tee -a "$LOG_DIR/codex-links-auto-sync.log"
