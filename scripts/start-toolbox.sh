#!/usr/bin/env bash
# Launch genai-toolbox in STDIO MCP mode with the Looker prebuilts.
#
# Claude Code spawns this via .mcp.json. The toolbox exposes Looker's
# API as MCP tools — what the dashboard-creator skill calls to verify
# field names, list explores, run queries, create dashboards, etc.
#
# Two prebuilts are loaded together:
#   --prebuilt looker      Standard Looker API tools (production endpoints,
#                          read-only against deployed LookML).
#   --prebuilt looker-dev  Dev-mode tools (write to a LookML project,
#                          deploy, validate). Required for bootstrap.sh
#                          to push the canvas manifest.
#
# Credentials come from looker-config.json at the repo root (gitignored).
# Falls back to LOOKER_* env vars if the file is missing.
#
# The toolbox binary is large (~150 MB) and not committed. Default path
# points at Adam's copy at ~/Projects/BQClaude/toolbox; customers can
# override via TOOLBOX_BIN or download the binary themselves from
# https://github.com/googleapis/genai-toolbox/releases.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="${LOOKER_CONFIG_FILE:-$ROOT/looker-config.json}"

# Find the toolbox binary.
TOOLBOX_BIN="${TOOLBOX_BIN:-}"
if [ -z "$TOOLBOX_BIN" ]; then
  for candidate in \
      "$ROOT/scripts/toolbox" \
      "$HOME/Projects/BQClaude/toolbox" \
      "$(command -v toolbox 2>/dev/null || true)"; do
    if [ -x "$candidate" ]; then
      TOOLBOX_BIN="$candidate"
      break
    fi
  done
fi
if [ -z "$TOOLBOX_BIN" ] || [ ! -x "$TOOLBOX_BIN" ]; then
  echo "error: toolbox binary not found. Set TOOLBOX_BIN to its path, or" >&2
  echo "       drop the binary at $ROOT/scripts/toolbox (chmod +x)." >&2
  echo "       Download: https://github.com/googleapis/genai-toolbox/releases" >&2
  exit 1
fi

# Read Looker credentials. Prefer the JSON config file (gitignored),
# fall back to env vars so this works in CI / fresh installs.
# Trailing slashes on base_url are stripped because the toolbox
# concatenates SDK paths directly; otherwise Looker's edge 403s on
# the resulting double-slash URL.
if [ -f "$CONFIG" ]; then
  LOOKER_BASE_URL="$(python3 -c "import json,sys;print(json.load(open('$CONFIG'))['base_url'].rstrip('/'))")"
  LOOKER_CLIENT_ID="$(python3 -c "import json,sys;print(json.load(open('$CONFIG'))['client_id'])")"
  LOOKER_CLIENT_SECRET="$(python3 -c "import json,sys;print(json.load(open('$CONFIG'))['client_secret'])")"
fi
LOOKER_BASE_URL="${LOOKER_BASE_URL%/}"
LOOKER_BASE_URL="${LOOKER_BASE_URL:-}"
LOOKER_CLIENT_ID="${LOOKER_CLIENT_ID:-}"
LOOKER_CLIENT_SECRET="${LOOKER_CLIENT_SECRET:-}"

if [ -z "$LOOKER_BASE_URL" ] || [ -z "$LOOKER_CLIENT_ID" ] || [ -z "$LOOKER_CLIENT_SECRET" ]; then
  echo "error: Looker credentials missing." >&2
  echo "       Provide LOOKER_BASE_URL, LOOKER_CLIENT_ID, LOOKER_CLIENT_SECRET" >&2
  echo "       in the environment, or populate $CONFIG." >&2
  exit 1
fi

export LOOKER_BASE_URL LOOKER_CLIENT_ID LOOKER_CLIENT_SECRET
export LOOKER_VERIFY_SSL="${LOOKER_VERIFY_SSL:-true}"

exec "$TOOLBOX_BIN" \
  --prebuilt looker \
  --prebuilt looker-dev \
  --stdio
