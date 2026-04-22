#!/bin/zsh
set -euo pipefail

ROOT="/Users/andriilitvinov/projects/MYPROJECTS/links"
PLIST_PATH="${HOME}/Library/LaunchAgents/com.andriilitvinov.codex-links-bridge.plist"
RUN_SCRIPT="${ROOT}/scripts/run-links-bridge.sh"
PROCESSOR_ID="${LINKS_BRIDGE_PROCESSOR_ID:-codex-links-bridge}"

if [[ -z "${LINKS_BASE_URL:-}" || -z "${LINKS_WRITE_TOKEN:-}" ]]; then
  echo "Set LINKS_BASE_URL and LINKS_WRITE_TOKEN before installing the bridge launch agent." >&2
  exit 1
fi

mkdir -p "${HOME}/Library/LaunchAgents"

cat > "${PLIST_PATH}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.andriilitvinov.codex-links-bridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>${RUN_SCRIPT}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>LINKS_BASE_URL</key>
    <string>${LINKS_BASE_URL}</string>
    <key>LINKS_WRITE_TOKEN</key>
    <string>${LINKS_WRITE_TOKEN}</string>
    <key>LINKS_BRIDGE_PROCESSOR_ID</key>
    <string>${PROCESSOR_ID}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>${HOME}/Library/Logs/codex-links-bridge.launchd.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/Library/Logs/codex-links-bridge.launchd.error.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/com.andriilitvinov.codex-links-bridge" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "${PLIST_PATH}"
launchctl kickstart -k "gui/$(id -u)/com.andriilitvinov.codex-links-bridge"

echo "Installed com.andriilitvinov.codex-links-bridge from ${ROOT}"
