#!/usr/bin/env bash
# Data Apps customer onboarding -- second-stage installer.
#
# Invoked by install.sh after the tarball is extracted (or directly
# from a git checkout for development). Walks the customer through:
#   1. genai-toolbox binary download (for the Looker MCP).
#   2. Looker credentials prompt -> looker-config.json.
#   3. Prompt for default model / explore / publish folder -> skill config.
#   4. Push the LookML manifest into the customer's Looker via
#      scripts/install-manifest.py (dev workspace).
#   5. Print the Looker IDE URL for the manual Commit + Deploy, and
#      the verify-install.py command that confirms it worked.
#
# Idempotent: re-running is safe. Existing config files are shown
# with a keep/re-enter prompt rather than silently skipped.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[1;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

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
  read -rp "$(echo -e "${BOLD}$1 [${YELLOW}Y/n${NC}${BOLD}]: ${NC}")" ans
  [ "${ans:-Y}" != "n" ] && [ "${ans:-Y}" != "N" ]
}

# show_config <json-file> <key>... — print the named keys so a re-run
# can offer keep/re-enter. Secrets print as "(hidden)".
show_config() {
  python3 - "$@" <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1]))
keys = sys.argv[2:]

if "target_url" in keys or "base_url" in keys:
    target = cfg.get("target_url", cfg.get("base_url", "(missing)"))
    is_proxy = cfg.get("base_url") == "http://127.0.0.1:9999"
    print(f"    \033[1mLooker URL\033[0m: \033[0;33m{target}\033[0m")
    print(f"    \033[1mSSO proxy\033[0m: \033[0;33m{'yes' if is_proxy else 'no'}\033[0m")
    for k in ["client_id", "client_secret"]:
        if k in keys:
            val = cfg.get(k, "(missing)")
            if k == "client_secret" and val != "(missing)": val = "(hidden)"
            print(f"    \033[1m{k}\033[0m: \033[0;33m{val}\033[0m")
else:
    for k in keys:
        if k == "tile_js_url": continue
        val = cfg.get(k, '(missing)')
        if isinstance(val, list): val = ", ".join(val)
        if k == "client_secret" and val != "(missing)":
            val = "(hidden)"
        print(f"    \033[1m{k}\033[0m: \033[0;33m{val}\033[0m")
PY
}

echo -e "${BLUE}${BOLD}Data Apps bootstrap — v${VERSION}${NC}\n"
echo -e "${BLUE}${BOLD}[1/5]${NC} using install dir: ${BOLD}$REPO_ROOT${NC}"

# ----------------------------------------------------------------------
# 1. Looker MCP via genai-toolbox
# ----------------------------------------------------------------------
#
# The repo ships a project-scoped .mcp.json + scripts/start-toolbox.sh.
# AI agents (like Claude Code, Antigravity, Cursor) pick them up
# automatically. We just need:
#   - the toolbox binary downloadable at scripts/toolbox (or set
#     TOOLBOX_BIN to your own path).
#   - looker-config.json populated with Looker API credentials so the
#     start script has something to authenticate with.

TOOLBOX_BIN_REPO="$REPO_ROOT/scripts/toolbox"
if [ ! -x "$TOOLBOX_BIN_REPO" ] && [ -z "${TOOLBOX_BIN:-}" ]; then
  echo -e "\n${BLUE}${BOLD}[2/5]${NC} genai-toolbox binary not found at ${BOLD}$TOOLBOX_BIN_REPO${NC}."
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
    echo -e "  Saved to ${BOLD}$TOOLBOX_BIN_REPO${NC} ($($TOOLBOX_BIN_REPO --version))."
  else
    echo -e "  ${YELLOW}Skipped.${NC} Drop the binary at $TOOLBOX_BIN_REPO before invoking the skill."
  fi
else
  echo -e "\n${BLUE}${BOLD}[2/5]${NC} toolbox binary present."
fi

LOOKER_CONFIG_PATH="$REPO_ROOT/looker-config.json"

prompt_looker_config() {
  echo ""
  echo "  Your Looker API credentials will be stored locally in"
  echo -e "  ${YELLOW}$LOOKER_CONFIG_PATH${NC} (gitignored). They are used only against"
  echo "  the Looker URL you provide — never sent to Google, Anthropic,"
  echo "  or any third party. See SECURITY.md."
  echo ""
  read -rp "$(echo -e "  ${BOLD}Looker instance URL [${YELLOW}https://meta.looker.com${NC}${BOLD}]: ${NC}")" LOOKER_URL
  LOOKER_URL="${LOOKER_URL:-https://meta.looker.com}"
  read -rp "$(echo -e "  ${BOLD}Looker API client_id: ${NC}")" LOOKER_CLIENT_ID_IN
  read -rsp "$(echo -e "  ${BOLD}Looker API client_secret: ${NC}")" LOOKER_CLIENT_SECRET_IN
  echo ""
  if ask_yn "  Does your Looker instance require an SSO proxy? (e.g. meta.looker.com)"; then
    USE_PROXY="yes"
  else
    USE_PROXY="no"
  fi
  echo ""
  python3 - "$LOOKER_CONFIG_PATH" "$LOOKER_URL" "$LOOKER_CLIENT_ID_IN" "$LOOKER_CLIENT_SECRET_IN" "$USE_PROXY" <<'PY'
import json, sys
path, url, cid, sec, use_proxy = sys.argv[1:]
# Strip trailing slashes; the toolbox concatenates the SDK path
# directly (`${base_url}/api/4.0/login`), so `https://x.looker.app/`
# becomes `https://x.looker.app//api/4.0/login` which Looker's edge
# 403s.
url = url.rstrip("/")

if use_proxy == "yes":
    # For SSO-protected Looker instances (like https://meta.looker.com),
    # API clients connect to the local looker_sso_proxy on http://127.0.0.1:9999
    open(path, "w").write(json.dumps({
        "base_url": "http://127.0.0.1:9999",
        "target_url": url,
        "client_id": cid,
        "client_secret": sec,
    }, indent=2) + "\n")
else:
    # Direct connection without proxy
    open(path, "w").write(json.dumps({
        "base_url": url,
        "target_url": url,
        "client_id": cid,
        "client_secret": sec,
    }, indent=2) + "\n")
PY
  echo -e "  Wrote ${YELLOW}$LOOKER_CONFIG_PATH${NC} (gitignored)."
}

if [ ! -f "$LOOKER_CONFIG_PATH" ]; then
  prompt_looker_config
else
  echo -e "  Existing ${YELLOW}$LOOKER_CONFIG_PATH${NC} found:"
  show_config "$LOOKER_CONFIG_PATH" target_url base_url client_id client_secret
  if ask_yn "  Keep these credentials?"; then
    echo -e "  ${GREEN}Keeping existing credentials.${NC}"
  else
    prompt_looker_config
  fi
fi

LOOKER_BASE_URL="$(python3 -c "import json;print(json.load(open('$LOOKER_CONFIG_PATH'))['base_url'])")"
if [ "$LOOKER_BASE_URL" = "http://127.0.0.1:9999" ]; then
  LOOKER_URL_FOR_PROXY="$(python3 -c "import json;cfg=json.load(open('$LOOKER_CONFIG_PATH'));print(cfg.get('target_url', cfg.get('base_url', 'https://meta.looker.com')))")"
  echo ""
  echo -e "  ${RED}${BOLD}Please execute the following command in a separate terminal before continuing:${NC}"
  echo -e "    ${CYAN}python3 /google/src/head/depot/google3/prototypes/projects/cloudbi_pm_workspace/looker-sso-proxy/looker_sso_proxy.py --target ${LOOKER_URL_FOR_PROXY}${NC}"
  echo ""
  if [ -t 0 ]; then
    read -rp "$(echo -e "  ${BOLD}Press Enter once the proxy is running in your separate terminal... ${NC}")" _dummy
  fi
  echo ""
fi

echo -e "  Toolbox MCP entry: ${YELLOW}$REPO_ROOT/.mcp.json${NC} (project-scoped, already committed)."

# ----------------------------------------------------------------------
# 2. Skill config
# ----------------------------------------------------------------------

SKILL_SRC="${REPO_ROOT}/skills/dashboard-creator"
CONFIG_FILE="${SKILL_SRC}/config.json"

prompt_skill_config() {
  LOOKER_URL="$(python3 -c "import json;print(json.load(open('$LOOKER_CONFIG_PATH'))['base_url'])")"
  read -rp "$(echo -e "  ${BOLD}Default LookML model (e.g. basic_ecomm): ${NC}")" MODEL
  read -rp "$(echo -e "  ${BOLD}Default explore in that model (e.g. basic_order_items): ${NC}")" EXPLORE
  read -rp "$(echo -e "  ${BOLD}Looker folder ID to publish dashboards into [${YELLOW}1${NC}${BOLD}]: ${NC}")" FOLDER
  FOLDER="${FOLDER:-1}"
  read -rp "$(echo -e "  ${BOLD}LookML project name to create in Looker [${YELLOW}canvas_dashboards${NC}${BOLD}]: ${NC}")" PROJECT
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
  echo -e "  Wrote ${YELLOW}$CONFIG_FILE${NC}."
}

if [ -f "$CONFIG_FILE" ]; then
  echo -e "\n${BLUE}${BOLD}[3/5]${NC} Skill config exists at ${YELLOW}$CONFIG_FILE${NC}:"
  show_config "$CONFIG_FILE" looker_instance_url default_model \
    default_explores publish_folder_id project_name tile_js_url
  if ask_yn "  Keep these settings?"; then
    echo -e "  ${GREEN}Keeping existing skill config.${NC}"
  else
    prompt_skill_config
  fi
else
  echo -e "\n${BLUE}${BOLD}[3/5]${NC} Writing skill config."
  prompt_skill_config
fi

# ----------------------------------------------------------------------
# 3. LookML manifest install
# ----------------------------------------------------------------------

echo -e "\n${BLUE}${BOLD}[4/5]${NC} Installing LookML manifest into Looker's dev workspace..."
TILE_URL_FOR_INSTALL="$(python3 -c "import json;print(json.load(open('$CONFIG_FILE')).get('tile_js_url',''))")"
PROJECT="$(python3 -c "import json;print(json.load(open('$CONFIG_FILE')).get('project_name','canvas_dashboards'))")"
python3 "$REPO_ROOT/scripts/install-manifest.py" \
  --config "$LOOKER_CONFIG_PATH" \
  --tile-js-url "$TILE_URL_FOR_INSTALL" \
  --project "$PROJECT"

# ----------------------------------------------------------------------
# 4. Final manual step (Looker IDE)
# ----------------------------------------------------------------------

LOOKER_URL_FROM_CFG="$(python3 -c "import json;cfg=json.load(open('$LOOKER_CONFIG_PATH'));print(cfg.get('target_url', cfg.get('base_url')))")"
echo -e "\n${BLUE}${BOLD}[5/5]${NC} Finish in the Looker IDE ${YELLOW}(one-time, 30 seconds):${NC}"
echo -e "        Open  ${BOLD}${LOOKER_URL_FROM_CFG}/projects/${PROJECT}/files/manifest.lkml${NC}"
echo -e "        Click ${BOLD}Validate LookML -> Commit Changes & Push -> Deploy to Production${NC}"
echo ""
echo "      Then confirm the deploy actually landed:"
echo -e "        ${YELLOW}python3 $REPO_ROOT/scripts/verify-install.py${NC}"
echo ""
echo "(Bare-repo Looker projects can't be deployed via the 4.0 API; "
echo "this last step has to happen through the IDE. verify-install.py "
echo "probes production and tells you if the deploy step was missed.)"

# ----------------------------------------------------------------------
# 5. Done
# ----------------------------------------------------------------------

echo -e "\n${GREEN}${BOLD}Done.${NC}\n"

echo -e "${CYAN}${BOLD}Next steps:${NC}"
echo -e "  ${BOLD}1.${NC} Open your AI agent (Claude Code, Antigravity, or Cursor) in this repo."
echo -e "  ${BOLD}2.${NC} Use the ${CYAN}/canvas-creator${NC} skill to build a dashboard."
echo -e "  ${BOLD}3.${NC} Iterate locally; publish when you're happy.\n"

echo -e "${BLUE}${BOLD}Install dir:${NC} $REPO_ROOT"
echo -e "${BLUE}${BOLD}Config:${NC}      $CONFIG_FILE"
echo -e "${BLUE}${BOLD}Version:${NC}     $VERSION\n"

echo -e "${YELLOW}To uninstall:${NC} bash $REPO_ROOT/scripts/uninstall.sh"
echo -e "${YELLOW}Data handling:${NC} see SECURITY.md and PRIVACY.md."
