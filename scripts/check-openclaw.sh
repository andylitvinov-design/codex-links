#!/usr/bin/env bash
set -euo pipefail

candidates=(openclaw open-claw claw)

for candidate in "${candidates[@]}"; do
  if binary_path="$(command -v "$candidate" 2>/dev/null)"; then
    version_output="$("$binary_path" --version 2>&1 | head -n 1 || true)"

    echo "status=installed"
    echo "binary=${candidate}"
    echo "path=${binary_path}"
    echo "version=${version_output:-needs verification}"
    echo "smoke_command=bash scripts/check-openclaw.sh"
    exit 0
  fi
done

echo "status=not installed"
echo "message=OpenClaw binary was not found. Checked: ${candidates[*]}." >&2
echo "next_action=Install or verify OpenClaw locally, then rerun: bash scripts/check-openclaw.sh"
exit 1
