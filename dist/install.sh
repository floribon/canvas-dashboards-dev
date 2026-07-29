#!/usr/bin/env bash
# Canvas Dashboards -- customer install entry point.
#
# Hosted at:
#   https://floribon.github.io/canvas-dashboards-dev/install.sh
#
# Customer one-liner:
#   bash <(curl -fsSL https://floribon.github.io/canvas-dashboards-dev/install.sh)
#
# This script:
#   1. Downloads the latest curated tarball from GitHub Pages.
#   2. Extracts it to a customer-chosen directory (default
#      ~/canvas-dashboards), preserving any existing looker-config.json
#      and skill config.json so re-running this acts as an upgrade.
#   3. Invokes scripts/bootstrap.sh in the extracted directory, which
#      walks the customer through the interactive setup.
#
# No git required, no internal-repo contents exposed.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[1;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

VERSION="dev-local"
echo -e "${BLUE}${BOLD}Starting Canvas Dashboards Installer v${VERSION}...${NC}"

TARBALL_URL="https://floribon.github.io/canvas-dashboards-dev/canvas-dashboards.tar.gz"
DEFAULT_INSTALL_DIR="${HOME}/canvas-dashboards"

# ----------------------------------------------------------------------
# 1. Pick install location
# ----------------------------------------------------------------------

if [ -t 0 ]; then
  read -rp "$(echo -e "${BOLD}Install directory [${YELLOW}${DEFAULT_INSTALL_DIR}${NC}${BOLD}]: ${NC}")" INSTALL_DIR
else
  # Non-interactive (piped); skip the prompt and use the default.
  INSTALL_DIR=""
fi
INSTALL_DIR="${INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"

# ----------------------------------------------------------------------
# 1.5. Safety check: prevent overwriting the developer repository
# ----------------------------------------------------------------------
if [ -d "$INSTALL_DIR/.git" ] || [ -d "$INSTALL_DIR/tests" ]; then
  echo -e "${RED}${BOLD}error: $INSTALL_DIR appears to be the Canvas Dashboards developer repository!${NC}" >&2
  echo -e "${RED}Running the installer here will extract the tarball and overwrite the source code.${NC}" >&2
  echo -e "${RED}Please run the installer again and specify a different directory (e.g. ~/canvas-install).${NC}" >&2
  exit 1
fi

# ----------------------------------------------------------------------
# 2. Preserve existing customer config across upgrades
# ----------------------------------------------------------------------

PRESERVE="$(mktemp -d -t canvas-dashboards-preserve.XXXXXX)"
preserved=0
if [ -f "${INSTALL_DIR}/looker-config.json" ]; then
  cp "${INSTALL_DIR}/looker-config.json" "$PRESERVE/looker-config.json"
  preserved=1
fi
if [ -f "${INSTALL_DIR}/skills/dashboard-creator/config.json" ]; then
  mkdir -p "$PRESERVE/skills/dashboard-creator"
  cp "${INSTALL_DIR}/skills/dashboard-creator/config.json" \
     "$PRESERVE/skills/dashboard-creator/config.json"
  preserved=1
fi
if [ "$preserved" = "1" ]; then
  echo -e "${GREEN}existing config detected in $INSTALL_DIR -- preserving across upgrade.${NC}"
fi

# ----------------------------------------------------------------------
# 3. Download + extract the tarball
# ----------------------------------------------------------------------

mkdir -p "$INSTALL_DIR"
echo -e "\n${BOLD}Downloading ${YELLOW}${TARBALL_URL}${NC}${BOLD}...${NC}"
TARBALL="$(mktemp -t canvas-dashboards.XXXXXX.tar.gz)"
trap 'rm -f "$TARBALL" "$TARBALL.sha256"; rm -rf "$PRESERVE"' EXIT
curl -fsSL -o "$TARBALL" "$TARBALL_URL"
curl -fsSL -o "$TARBALL.sha256" "${TARBALL_URL}.sha256"

# Verify the checksum published next to the tarball before extracting.
# GitHub Pages serves both files, so this catches truncation/corruption in
# transit and any mismatch between what release.sh built and what we
# received. (shasum on macOS, sha256sum on most Linux.)
echo -e "${BOLD}Verifying checksum...${NC}"
EXPECTED="$(cut -d' ' -f1 "$TARBALL.sha256")"
if command -v shasum >/dev/null 2>&1; then
  ACTUAL="$(shasum -a 256 "$TARBALL" | cut -d' ' -f1)"
else
  ACTUAL="$(sha256sum "$TARBALL" | cut -d' ' -f1)"
fi
if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then
  echo -e "${RED}${BOLD}error: checksum mismatch for canvas-dashboards.tar.gz${NC}" >&2
  echo -e "${RED}  expected: ${EXPECTED:-<empty>}${NC}" >&2
  echo -e "${RED}  actual:   $ACTUAL${NC}" >&2
  echo -e "${RED}The download is corrupt or the bucket is mid-release. Re-run${NC}" >&2
  echo -e "${RED}the installer; if it persists, contact your Google rep.${NC}" >&2
  exit 1
fi
echo -e "${GREEN}Checksum OK (${ACTUAL})${NC}"

echo -e "${BOLD}Extracting into ${YELLOW}$INSTALL_DIR${NC}${BOLD}...${NC}"
tar -xzf "$TARBALL" -C "$INSTALL_DIR"

# Restore preserved config (overwrites whatever was in the tarball,
# which is fine -- they're customer-specific files we never ship).
if [ -f "$PRESERVE/looker-config.json" ]; then
  cp "$PRESERVE/looker-config.json" "$INSTALL_DIR/looker-config.json"
fi
if [ -f "$PRESERVE/skills/dashboard-creator/config.json" ]; then
  cp "$PRESERVE/skills/dashboard-creator/config.json" \
     "$INSTALL_DIR/skills/dashboard-creator/config.json"
fi

# ----------------------------------------------------------------------
# 4. Hand off to bootstrap
# ----------------------------------------------------------------------

cd "$INSTALL_DIR"
exec bash scripts/bootstrap.sh
