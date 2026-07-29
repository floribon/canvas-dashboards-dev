#!/usr/bin/env bash
# Data Apps — uninstaller.
#
# Reverses what bootstrap.sh set up on the customer's machine:
#   1. Optionally deletes looker-config.json (prompts; default keep).
#   2. Optionally deletes skills/dashboard-creator/config.json (prompts).
#   3. Optionally deletes the install directory itself (prompts).
#
# Does NOT touch your Looker instance — the canvas_dashboards LookML
# project and any published dashboards stay where they are. Delete them
# manually in the Looker IDE if you want a clean Looker too.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOOKER_CONFIG="${REPO_ROOT}/looker-config.json"
SKILL_CONFIG="${REPO_ROOT}/skills/dashboard-creator/config.json"

VERSION="$(cat "$REPO_ROOT/VERSION" 2>/dev/null || echo "unknown")"
echo "Data Apps uninstall — v${VERSION}"
echo "  install dir: $REPO_ROOT"
echo


# ----------------------------------------------------------------------
# 1. Looker credentials
# ----------------------------------------------------------------------

if [ -f "$LOOKER_CONFIG" ]; then
  read -rp "[1/3] delete $LOOKER_CONFIG (contains Looker API credentials)? [y/N]: " ans
  if [ "${ans:-N}" = "y" ] || [ "${ans:-N}" = "Y" ]; then
    rm "$LOOKER_CONFIG"
    echo "      deleted."
  else
    echo "      kept."
  fi
else
  echo "[1/3] $LOOKER_CONFIG not present."
fi

# ----------------------------------------------------------------------
# 2. Skill config
# ----------------------------------------------------------------------

if [ -f "$SKILL_CONFIG" ]; then
  read -rp "[2/3] delete $SKILL_CONFIG (skill defaults)? [y/N]: " ans
  if [ "${ans:-N}" = "y" ] || [ "${ans:-N}" = "Y" ]; then
    rm "$SKILL_CONFIG"
    echo "      deleted."
  else
    echo "      kept."
  fi
else
  echo "[2/3] $SKILL_CONFIG not present."
fi

# ----------------------------------------------------------------------
# 3. Install directory
# ----------------------------------------------------------------------

echo "[3/3] install directory: $REPO_ROOT"
echo "      Delete it manually if you want it gone:"
echo "        rm -rf \"$REPO_ROOT\""
echo "      (We don't auto-delete the directory we're running from.)"

# ----------------------------------------------------------------------
# Looker-side cleanup pointer
# ----------------------------------------------------------------------

echo
echo "Looker-side cleanup (manual, optional):"
echo "  - Delete the canvas_dashboards LookML project in the IDE if"
echo "    you don't want the extension available anymore."
echo "  - Delete any dashboards you published with Data Apps tiles"
echo "    (or just delete the tiles)."
echo
echo "Done."
