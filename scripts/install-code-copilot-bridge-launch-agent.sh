#!/bin/zsh
set -euo pipefail

ROOT="${CODEX_LINKS_ROOT:-/Users/andriilitvinov/projects/MYPROJECTS/links}"
LABEL="com.andriilitvinov.codex-links-code-copilot-bridge"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="${HOME}/Library/Logs"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
BASE_URL="${CODEX_LINKS_BASE_URL:-${LINKS_BASE_URL:-}}"

if [[ ! -d "${ROOT}" ]]; then
  echo "Repo root not found: ${ROOT}" >&2
  echo "Set CODEX_LINKS_ROOT=/path/to/codex-links before running." >&2
  exit 1
fi

if [[ -z "${LINKS_WRITE_TOKEN:-}" ]]; then
  echo "Set LINKS_WRITE_TOKEN before installing the Code Copilot bridge launch agent." >&2
  exit 1
fi

if [[ -z "${BASE_URL}" ]]; then
  echo "Set CODEX_LINKS_BASE_URL or LINKS_BASE_URL before installing the Code Copilot bridge launch agent." >&2
  exit 1
fi

mkdir -p "${HOME}/Library/LaunchAgents" "${LOG_DIR}"

cat > "${PLIST_PATH}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${ROOT}/scripts/code-copilot-bridge.mjs</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CODEX_LINKS_BASE_URL</key>
    <string>${BASE_URL}</string>
    <key>LINKS_WRITE_TOKEN</key>
    <string>${LINKS_WRITE_TOKEN}</string>
    <key>CODE_COPILOT_LOCAL_PROVIDER</key>
    <string>${CODE_COPILOT_LOCAL_PROVIDER:-ollama}</string>
    <key>CODE_COPILOT_MODEL</key>
    <string>${CODE_COPILOT_MODEL:-qwen2.5-coder:7b}</string>
    <key>CODE_COPILOT_OLLAMA_URL</key>
    <string>${CODE_COPILOT_OLLAMA_URL:-http://127.0.0.1:11434/api/generate}</string>
    <key>CODE_COPILOT_LMSTUDIO_URL</key>
    <string>${CODE_COPILOT_LMSTUDIO_URL:-http://127.0.0.1:1234/v1/chat/completions}</string>
    <key>CODE_COPILOT_POLL_INTERVAL_MS</key>
    <string>${CODE_COPILOT_POLL_INTERVAL_MS:-5000}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/codex-links-code-copilot-bridge.launchd.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/codex-links-code-copilot-bridge.launchd.error.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "${PLIST_PATH}"
launchctl kickstart -k "gui/$(id -u)/${LABEL}"

echo "Installed ${LABEL} from ${ROOT}"
echo "Status: launchctl print gui/$(id -u)/${LABEL}"
echo "Logs: ${LOG_DIR}/codex-links-code-copilot-bridge.launchd.log"
echo "Errors: ${LOG_DIR}/codex-links-code-copilot-bridge.launchd.error.log"
