#!/bin/zsh

set -euo pipefail

ROOT="/Users/andriilitvinov/projects/MYPROJECTS/links"
AUTOMATION_TOML="${HOME}/.codex/automations/links-inbox/automation.toml"
LOCK_DIR="${TMPDIR:-/tmp}/codex-links-bridge.lock"
LOCK_PID_FILE="${LOCK_DIR}/pid"
NODE_BIN="/usr/local/bin/node"
PATH="/usr/local/bin:/Users/andriilitvinov/.npm-global/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "${HOME}/Library/Logs"

acquire_lock() {
  if mkdir "${LOCK_DIR}" 2>/dev/null; then
    echo "$$" > "${LOCK_PID_FILE}"
    return 0
  fi

  if [[ -f "${LOCK_PID_FILE}" ]]; then
    local existing_pid
    existing_pid="$(cat "${LOCK_PID_FILE}" 2>/dev/null || true)"

    if [[ -n "${existing_pid}" ]] && kill -0 "${existing_pid}" 2>/dev/null; then
      return 1
    fi
  fi

  rm -rf "${LOCK_DIR}" 2>/dev/null || true

  if mkdir "${LOCK_DIR}" 2>/dev/null; then
    echo "$$" > "${LOCK_PID_FILE}"
    return 0
  fi

  return 1
}

if ! acquire_lock; then
  exit 0
fi

cleanup() {
  rm -f "${LOCK_PID_FILE}" 2>/dev/null || true
  rmdir "${LOCK_DIR}" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

extract_from_automation() {
  local key="$1"

  if [[ ! -f "${AUTOMATION_TOML}" ]]; then
    return 0
  fi

  perl -ne "print qq{\$1\n} if /${key}='([^']+)'/" "${AUTOMATION_TOML}" | head -n 1
}

BASE_URL="${LINKS_BASE_URL:-$(extract_from_automation LINKS_BASE_URL)}"
WRITE_TOKEN="${LINKS_WRITE_TOKEN:-$(extract_from_automation LINKS_WRITE_TOKEN)}"

if [[ -z "${BASE_URL}" ]]; then
  BASE_URL="https://codex-links.pages.dev"
fi

if [[ -z "${WRITE_TOKEN}" ]]; then
  echo "Missing LINKS_WRITE_TOKEN for codex-links bridge." >&2
  exit 1
fi

cd "${ROOT}"
env \
  PATH="${PATH}" \
  LINKS_BASE_URL="${BASE_URL}" \
  LINKS_WRITE_TOKEN="${WRITE_TOKEN}" \
  "${NODE_BIN}" scripts/sync-codex-threads.mjs >/dev/null 2>&1 || true

exec env \
  PATH="${PATH}" \
  LINKS_BASE_URL="${BASE_URL}" \
  LINKS_WRITE_TOKEN="${WRITE_TOKEN}" \
  "${NODE_BIN}" scripts/bridge-codex-commands.mjs
