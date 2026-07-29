#!/usr/bin/env bash
# Update the deployment host URL across the repository
#
# Usage:
#   github-admin/update-host.sh <new_url>
#
# Example:
#   github-admin/update-host.sh "https://floribon.github.io/canvas-dashboards-dev"

set -euo pipefail

NEW_HOST="${1:?usage: github-admin/update-host.sh <new_url>}"
# Strip trailing slash if present
NEW_HOST="${NEW_HOST%/}"

echo "Updating host to $NEW_HOST in repository files..."

# Ensure we're at the repo root
cd "$(dirname "$0")/.."

# Replace in install.sh (the TARBALL_URL variable)
if [ "$(uname)" = "Darwin" ]; then
  sed -i '' -E "s|TARBALL_URL=\"https?://[^\"]+\"|TARBALL_URL=\"${NEW_HOST}/canvas-dashboards.tar.gz\"|g" install.sh
  sed -i '' -E "s|curl -fsSL https?://[^/]+/[^/]+/install\.sh|curl -fsSL ${NEW_HOST}/install.sh|g" install.sh
  sed -i '' -E "s|https?://[^/]+/[^/]+/install\.sh|${NEW_HOST}/install.sh|g" install.sh
  
  # Replace the bash <(curl ...) one-liners in documentation
  sed -i '' -E "s|curl -fsSL https?://[^/]+/[^/]+/install\.sh|curl -fsSL ${NEW_HOST}/install.sh|g" README.md
  sed -i '' -E "s|curl -fsSL https?://[^/]+/[^/]+/install\.sh|curl -fsSL ${NEW_HOST}/install.sh|g" docs/customer-quickstart.md
else
  sed -i -E "s|TARBALL_URL=\"https?://[^\"]+\"|TARBALL_URL=\"${NEW_HOST}/canvas-dashboards.tar.gz\"|g" install.sh
  sed -i -E "s|curl -fsSL https?://[^/]+/[^/]+/install\.sh|curl -fsSL ${NEW_HOST}/install.sh|g" install.sh
  sed -i -E "s|https?://[^/]+/[^/]+/install\.sh|${NEW_HOST}/install.sh|g" install.sh
  
  # Replace the bash <(curl ...) one-liners in documentation
  sed -i -E "s|curl -fsSL https?://[^/]+/[^/]+/install\.sh|curl -fsSL ${NEW_HOST}/install.sh|g" README.md
  sed -i -E "s|curl -fsSL https?://[^/]+/[^/]+/install\.sh|curl -fsSL ${NEW_HOST}/install.sh|g" docs/customer-quickstart.md
fi

echo "Done! The host has been updated."
echo "Please commit these changes before pushing."
