#!/usr/bin/env bash
# Data Apps — uninstaller.
#
# Reverses what bootstrap.sh set up on the customer's machine:
#   1. Removes the dashboard-creator skill symlink from ~/.claude/skills/.
#   2. Optionally deletes looker-config.json (prompts; default keep).
#   3. Optionally deletes skills/dashboard-creator/config.json (prompts).
#   4. Optionally deletes the install directory itself (prompts).
#
# Does NOT touch your Looker instance — the canvas_dashboards LookML
# project and any published dashboards stay where they are. Delete them
# manually in the Looker IDE if you want a clean Looker too.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLAUDE_DIR="${HOME}/.claude"
SKILL_LINK="${CLAUDE_DIR}/skills/dashboard-creator"
LOOKER_CONFIG="${REPO_ROOT}/looker-config.json"
SKILL_CONFIG="${REPO_ROOT}/skills/dashboard-creator/config.json"

VERSION="$(cat "$REPO_ROOT/VERSION" 2>/dev/null || echo "unknown")"
echo "Data Apps uninstall — v${VERSION}"
echo "  install dir: $REPO_ROOT"
echo

# ----------------------------------------------------------------------
# 1. Skill symlink
# ----------------------------------------------------------------------

if [ -L "$SKILL_LINK" ]; then
  echo "[1/4] removing skill symlink: $SKILL_LINK"
  rm "$SKILL_LINK"
elif [ -e "$SKILL_LINK" ]; then
  echo "[1/4] $SKILL_LINK exists but isn't a symlink — leaving alone."
else
  echo "[1/4] skill symlink not present."
fi

# ----------------------------------------------------------------------
# 2. Looker credentials
# ----------------------------------------------------------------------

if [ -f "$LOOKER_CONFIG" ]; then
  read -rp "[2/4] delete $LOOKER_CONFIG (contains Looker API credentials)? [y/N]: " ans
  if [ "${ans:-N}" = "y" ] || [ "${ans:-N}" = "Y" ]; then
    rm "$LOOKER_CONFIG"
    echo "      deleted."
  else
    echo "      kept."
  fi
else
  echo "[2/4] $LOOKER_CONFIG not present."
fi

# ----------------------------------------------------------------------
# 3. Skill config
# ----------------------------------------------------------------------

if [ -f "$SKILL_CONFIG" ]; then
  read -rp "[3/4] delete $SKILL_CONFIG (skill defaults)? [y/N]: " ans
  if [ "${ans:-N}" = "y" ] || [ "${ans:-N}" = "Y" ]; then
    rm "$SKILL_CONFIG"
    echo "      deleted."
  else
    echo "      kept."
  fi
else
  echo "[3/4] $SKILL_CONFIG not present."
fi

# ----------------------------------------------------------------------
# 4. Install directory
# ----------------------------------------------------------------------

echo "[4/4] install directory: $REPO_ROOT"
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
