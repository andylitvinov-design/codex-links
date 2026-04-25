#!/usr/bin/env bash
set -euo pipefail

OUTBOX_DIR="${CODEX_OUTBOX_DIR:-.codex-outbox}"
SYNC_STATE_DIR="${CODEX_SYNC_STATE_DIR:-.codex-sync}"
COMMIT_MESSAGE="${AUTO_SYNC_COMMIT_MESSAGE:-chore: sync codex outbox}"

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

mkdir -p "$OUTBOX_DIR" "$SYNC_STATE_DIR/processed"

shopt -s nullglob
patches=("$OUTBOX_DIR"/*.patch)

if [ "${#patches[@]}" -gt 0 ]; then
  for patch in "${patches[@]}"; do
    echo "[auto-sync] applying outbox patch: $patch"
    git apply --check "$patch"
    git apply "$patch"
    mv "$patch" "$SYNC_STATE_DIR/processed/$(basename "$patch").$(date -u +%Y%m%d%H%M%S)"
  done
fi

if [ -z "$(git status --porcelain)" ]; then
  echo "[auto-sync] outbox empty; no changes to sync"
  exit 0
fi

AUTO_SYNC_COMMIT_MESSAGE="$COMMIT_MESSAGE" scripts/setup_remote_and_pr.sh
