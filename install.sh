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

VERSION="dev-local"
echo "Starting Canvas Dashboards Installer v${VERSION}..."

TARBALL_URL="https://floribon.github.io/canvas-dashboards-dev/canvas-dashboards.tar.gz"
DEFAULT_INSTALL_DIR="${HOME}/canvas-dashboards"

# ----------------------------------------------------------------------
# 1. Pick install location
# ----------------------------------------------------------------------

if [ -t 0 ]; then
  read -rp "Install directory [${DEFAULT_INSTALL_DIR}]: " INSTALL_DIR
else
  # Non-interactive (piped); skip the prompt and use the default.
  INSTALL_DIR=""
fi
INSTALL_DIR="${INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"

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
  echo "existing config detected in $INSTALL_DIR -- preserving across upgrade."
fi

# ----------------------------------------------------------------------
# 3. Download + extract the tarball
# ----------------------------------------------------------------------

mkdir -p "$INSTALL_DIR"
echo "downloading ${TARBALL_URL}..."
TARBALL="$(mktemp -t canvas-dashboards.XXXXXX.tar.gz)"
trap 'rm -f "$TARBALL" "$TARBALL.sha256"; rm -rf "$PRESERVE"' EXIT
curl -fsSL -o "$TARBALL" "$TARBALL_URL"
curl -fsSL -o "$TARBALL.sha256" "${TARBALL_URL}.sha256"

# Verify the checksum published next to the tarball before extracting.
# GitHub Pages serves both files, so this catches truncation/corruption in
# transit and any mismatch between what release.sh built and what we
# received. (shasum on macOS, sha256sum on most Linux.)
echo "verifying checksum..."
EXPECTED="$(cut -d' ' -f1 "$TARBALL.sha256")"
if command -v shasum >/dev/null 2>&1; then
  ACTUAL="$(shasum -a 256 "$TARBALL" | cut -d' ' -f1)"
else
  ACTUAL="$(sha256sum "$TARBALL" | cut -d' ' -f1)"
fi
if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "error: checksum mismatch for canvas-dashboards.tar.gz" >&2
  echo "  expected: ${EXPECTED:-<empty>}" >&2
  echo "  actual:   $ACTUAL" >&2
  echo "The download is corrupt or the bucket is mid-release. Re-run" >&2
  echo "the installer; if it persists, contact your Google rep." >&2
  exit 1
fi
echo "checksum ok (${ACTUAL})"

echo "extracting into $INSTALL_DIR..."
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
