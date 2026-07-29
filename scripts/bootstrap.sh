#!/usr/bin/env bash
# Data Apps customer onboarding -- second-stage installer.
#
# Invoked by install.sh after the tarball is extracted (or directly
# from a git checkout for development). Walks the customer through:
#   1. genai-toolbox binary download (for the Looker MCP).
#   2. Looker credentials prompt -> looker-config.json.
#   3. Symlink the dashboard-creator skill into ~/.claude/skills/.
#   4. Prompt for default model / explore / publish folder -> skill config.
#   5. Push the LookML manifest into the customer's Looker via
#      scripts/install-manifest.py (dev workspace).
#   6. Print the Looker IDE URL for the manual Commit + Deploy, and
#      the verify-install.py command that confirms it worked.
#
# Idempotent: re-running is safe. Existing config files are shown
# with a keep/re-enter prompt rather than silently skipped.

set -euo pipefail

DEFAULT_TILE_JS_URL="https://storage.googleapis.com/canvas-dashboards-shared/hosts/tile.js"

# Resolve the install root (the directory containing this script's
# parent). If you're running from a git checkout, that's the repo
# root; if you're running from a tarball-installed location, that's
# the install dir.
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

VERSION="$(cat "$REPO_ROOT/VERSION" 2>/dev/null || echo "unknown")"

# Yes/no prompt defaulting to yes. Returns 0 unless the answer is n/N.
ask_yn() {
  local ans
  read -rp "$1 [Y/n]: " ans
  [ "${ans:-Y}" != "n" ] && [ "${ans:-Y}" != "N" ]
}

# show_config <json-file> <key>... — print the named keys so a re-run
# can offer keep/re-enter. Secrets print as "(hidden)".
show_config() {
  python3 - "$@" <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1]))
for k in sys.argv[2:]:
    if k == "client_secret":
        print(f"    {k}: (hidden)" if k in cfg else f"    {k}: (missing)")
    else:
        print(f"    {k}: {cfg.get(k, '(missing)')}")
PY
}

echo "Data Apps bootstrap — v${VERSION}"
echo
echo "[1/6] using install dir: $REPO_ROOT"

# ----------------------------------------------------------------------
# 1. Looker MCP via genai-toolbox
# ----------------------------------------------------------------------
#
# The repo ships a project-scoped .mcp.json + scripts/start-toolbox.sh.
# Claude Code picks them up automatically. We just need:
#   - the toolbox binary downloadable at scripts/toolbox (or set
#     TOOLBOX_BIN to your own path).
#   - looker-config.json populated with Looker API credentials so the
#     start script has something to authenticate with.

CLAUDE_DIR="${HOME}/.claude"
mkdir -p "$CLAUDE_DIR"

TOOLBOX_BIN_REPO="$REPO_ROOT/scripts/toolbox"
if [ ! -x "$TOOLBOX_BIN_REPO" ] && [ -z "${TOOLBOX_BIN:-}" ]; then
  echo "[2/6] genai-toolbox binary not found at $TOOLBOX_BIN_REPO."
  echo "  The dashboard-creator skill needs it to verify LookML field"
  echo "  names while authoring — without it, drafts fail later with"
  echo "  field_not_found errors."
  if ask_yn "  Download it now from googleapis/mcp-toolbox?"; then
    OS="$(uname | tr '[:upper:]' '[:lower:]')"
    ARCH="$(uname -m | sed -e 's/x86_64/amd64/' -e 's/aarch64/arm64/')"
    # Pinned to a known-good version. The dev_mode tool was broken in
    # 1.1.0 and earlier (PATCH /session 404'd); 1.3.0 fixes it. Bump
    # when newer versions are validated against the Looker API we
    # target. Local to this branch so we don't clobber the
    # canvas-dashboards $VERSION read above.
    TOOLBOX_VERSION_PIN="${TOOLBOX_VERSION:-1.3.0}"
    URL="https://storage.googleapis.com/mcp-toolbox-for-databases/v${TOOLBOX_VERSION_PIN}/${OS}/${ARCH}/toolbox"
    echo "  Downloading $URL ..."
    curl -fsSL -o "$TOOLBOX_BIN_REPO" "$URL"
    chmod +x "$TOOLBOX_BIN_REPO"
    echo "  Saved to $TOOLBOX_BIN_REPO ($($TOOLBOX_BIN_REPO --version))."
  else
    echo "  Skipped. Drop the binary at $TOOLBOX_BIN_REPO before invoking the skill."
  fi
else
  echo "[2/6] toolbox binary present."
fi

LOOKER_CONFIG_PATH="$REPO_ROOT/looker-config.json"

prompt_looker_config() {
  echo ""
  echo "  Your Looker API credentials will be stored locally in"
  echo "  $LOOKER_CONFIG_PATH (gitignored). They are used only against"
  echo "  the Looker URL you provide — never sent to Google, Anthropic,"
  echo "  or any third party. See SECURITY.md."
  echo ""
  read -rp "  Looker instance URL (e.g. https://yourco.looker.app): " LOOKER_URL
  read -rp "  Looker API client_id: " LOOKER_CLIENT_ID_IN
  read -rsp "  Looker API client_secret: " LOOKER_CLIENT_SECRET_IN
  echo ""
  python3 - "$LOOKER_CONFIG_PATH" "$LOOKER_URL" "$LOOKER_CLIENT_ID_IN" "$LOOKER_CLIENT_SECRET_IN" <<'PY'
import json, sys
path, url, cid, sec = sys.argv[1:]
# Strip trailing slashes; the toolbox concatenates the SDK path
# directly (`${base_url}/api/4.0/login`), so `https://x.looker.app/`
# becomes `https://x.looker.app//api/4.0/login` which Looker's edge
# 403s.
url = url.rstrip("/")
open(path, "w").write(json.dumps({
    "base_url": url,
    "client_id": cid,
    "client_secret": sec,
}, indent=2) + "\n")
PY
  echo "  Wrote $LOOKER_CONFIG_PATH (gitignored)."
}

if [ ! -f "$LOOKER_CONFIG_PATH" ]; then
  prompt_looker_config
else
  echo "  Existing $LOOKER_CONFIG_PATH found:"
  show_config "$LOOKER_CONFIG_PATH" base_url client_id client_secret
  if ask_yn "  Keep these credentials?"; then
    echo "  Keeping existing credentials."
  else
    prompt_looker_config
  fi
fi

echo "  Toolbox MCP entry: $REPO_ROOT/.mcp.json (project-scoped, already committed)."

# ----------------------------------------------------------------------
# 2. Skill symlink
# ----------------------------------------------------------------------

SKILLS_DIR="${CLAUDE_DIR}/skills"
mkdir -p "$SKILLS_DIR"
SKILL_LINK="${SKILLS_DIR}/dashboard-creator"
SKILL_SRC="${REPO_ROOT}/skills/dashboard-creator"
if [ -L "$SKILL_LINK" ]; then
  echo "[3/6] Skill symlink exists at $SKILL_LINK -- skipping."
elif [ -e "$SKILL_LINK" ]; then
  echo "[3/6] $SKILL_LINK exists but isn't a symlink. Leave it alone or rename and rerun."
else
  ln -s "$SKILL_SRC" "$SKILL_LINK"
  echo "[3/6] Symlinked $SKILL_SRC -> $SKILL_LINK."
fi

# ----------------------------------------------------------------------
# 3. Skill config
# ----------------------------------------------------------------------

CONFIG_FILE="${SKILL_SRC}/config.json"

prompt_skill_config() {
  LOOKER_URL="$(python3 -c "import json;print(json.load(open('$LOOKER_CONFIG_PATH'))['base_url'])")"
  read -rp "  Default LookML model (e.g. basic_ecomm): " MODEL
  read -rp "  Default explore in that model (e.g. basic_order_items): " EXPLORE
  read -rp "  Looker folder ID to publish dashboards into [1]: " FOLDER
  FOLDER="${FOLDER:-1}"
  read -rp "  LookML project name to create in Looker [canvas_dashboards]: " PROJECT
  PROJECT="${PROJECT:-canvas_dashboards}"
  TILE_URL="$DEFAULT_TILE_JS_URL"
  python3 - "$CONFIG_FILE" "$LOOKER_URL" "$MODEL" "$EXPLORE" "$FOLDER" "$TILE_URL" "$PROJECT" <<'PY'
import json, sys
path, url, model, explore, folder, tile_url, project = sys.argv[1:]
open(path, "w").write(json.dumps({
    "looker_instance_url": url,
    "default_model": model,
    "default_explores": [explore],
    "publish_folder_id": folder,
    "tile_js_url": tile_url,
    "project_name": project,
}, indent=2) + "\n")
PY
  echo "  Wrote $CONFIG_FILE."
}

if [ -f "$CONFIG_FILE" ]; then
  echo "[4/6] Skill config exists at $CONFIG_FILE:"
  show_config "$CONFIG_FILE" looker_instance_url default_model \
    default_explores publish_folder_id project_name tile_js_url
  if ask_yn "  Keep these settings?"; then
    echo "  Keeping existing skill config."
  else
    prompt_skill_config
  fi
else
  echo "[4/6] Writing skill config."
  prompt_skill_config
fi

# ----------------------------------------------------------------------
# 4. LookML manifest install
# ----------------------------------------------------------------------

echo "[5/6] Installing LookML manifest into Looker's dev workspace..."
TILE_URL_FOR_INSTALL="$(python3 -c "import json;print(json.load(open('$CONFIG_FILE')).get('tile_js_url',''))")"
PROJECT="$(python3 -c "import json;print(json.load(open('$CONFIG_FILE')).get('project_name','canvas_dashboards'))")"
python3 "$REPO_ROOT/scripts/install-manifest.py" \
  --config "$LOOKER_CONFIG_PATH" \
  --tile-js-url "$TILE_URL_FOR_INSTALL" \
  --project "$PROJECT"

# ----------------------------------------------------------------------
# 5. Final manual step (Looker IDE)
# ----------------------------------------------------------------------

LOOKER_URL_FROM_CFG="$(python3 -c "import json;print(json.load(open('$LOOKER_CONFIG_PATH'))['base_url'])")"
echo "[6/6] Finish in the Looker IDE (one-time, 30 seconds):"
echo "        Open  ${LOOKER_URL_FROM_CFG}/projects/${PROJECT}/files/manifest.lkml"
echo "        Click Validate LookML -> Commit Changes & Push -> Deploy to Production"
echo ""
echo "      Then confirm the deploy actually landed:"
echo "        python3 $REPO_ROOT/scripts/verify-install.py"
echo ""
echo "(Bare-repo Looker projects can't be deployed via the 4.0 API; "
echo "this last step has to happen through the IDE. verify-install.py "
echo "probes production and tells you if the deploy step was missed.)"

# ----------------------------------------------------------------------
# 6. Done
# ----------------------------------------------------------------------

cat <<EOF

Done.

Next:
  1. Open Claude Code in this repo (or your own working dir).
  2. Ask: "Use the dashboard-creator skill to create a sales dashboard
     against the ${MODEL:-<model>} model with [your spec]."
  3. Iterate locally; publish when you're happy.

Install dir: $REPO_ROOT
Skill:       $SKILL_LINK
Config:      $CONFIG_FILE
Version:     $VERSION

To uninstall: bash $REPO_ROOT/scripts/uninstall.sh
Data handling: see $REPO_ROOT/SECURITY.md and $REPO_ROOT/PRIVACY.md.
EOF
