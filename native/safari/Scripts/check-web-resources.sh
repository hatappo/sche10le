#!/bin/sh
set -eu

repo_root="$SRCROOT/../.."
manifest="$repo_root/.output/safari-mv3/manifest.json"
fail() {
  echo "error: $1 Run 'npm run prepare:safari' in the repository, then build again." >&2
  exit 1
}
[ -f "$manifest" ] || fail "Safari web resources are missing."
package_version=$(/usr/bin/plutil -extract version raw -o - "$repo_root/package.json")
manifest_version=$(/usr/bin/plutil -extract version raw -o - "$manifest")
[ "$manifest_version" = "$package_version" ] || fail "The Safari manifest version is stale."
[ "$MARKETING_VERSION" = "$package_version" ] || fail "The native app version is stale."
