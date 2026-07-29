#!/usr/bin/env bash
# Spin up the dev server and open the standalone preview for a canvas
# def the skill is iterating on. Idempotent — leaves an already-running
# serve.py alone.
#
# Usage:
#   bash skills/dashboard-creator/tools/start-preview.sh <path-to-def>
#
# Example:
#   bash skills/dashboard-creator/tools/start-preview.sh drafts/sales.canvasdashboard.html

set -euo pipefail

DEF_PATH="${1:?usage: start-preview.sh <path-to-canvasdashboard.html>}"
PORT="${PORT:-8765}"

# `pwd -P` after `cd`s into the script's directory canonicalizes
# through any symlinks in the path, so we end up at the real on-disk
# install location.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

if [ ! -f "$ROOT/$DEF_PATH" ]; then
  echo "error: def not found at $ROOT/$DEF_PATH" >&2
  exit 1
fi

# Start serve.py in background if nothing is listening on PORT.
if ! curl -s --max-time 1 "http://localhost:${PORT}/runtime/standalone.html" \
       -o /dev/null -w "" 2>/dev/null; then
  echo "starting serve.py on port ${PORT}..."
  (cd "$ROOT" && PORT="$PORT" python3 serve.py >/tmp/canvas-serve.log 2>&1 &)
  # Wait briefly for it to bind.
  for _ in 1 2 3 4 5; do
    sleep 1
    if curl -s --max-time 1 "http://localhost:${PORT}/runtime/standalone.html" \
           -o /dev/null -w "" 2>/dev/null; then
      break
    fi
  done
fi

URL="http://localhost:${PORT}/runtime/standalone.html?path=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$DEF_PATH")"
echo "preview URL: $URL"

# Best-effort open in default browser. Silent if neither is available.
if command -v open >/dev/null 2>&1; then
  open "$URL"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL"
fi
