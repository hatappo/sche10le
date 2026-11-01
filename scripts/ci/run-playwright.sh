#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
image=$(cat "$repo_root/scripts/ci/playwright-image.txt")

if [ "$(id -u)" -eq 0 ]; then
  echo "Run the test container as a non-root user." >&2
  exit 1
fi

# Mount only the checkout. Do not pass GitHub credentials or the Docker socket.
docker run --rm --init \
  --user "$(id -u):$(id -g)" \
  --shm-size=1g \
  --security-opt no-new-privileges \
  --security-opt "seccomp=$repo_root/scripts/ci/seccomp_profile.json" \
  --mount "type=bind,source=$repo_root,target=/workspace" \
  --workdir /workspace \
  --env HOME=/tmp \
  --env TZ=Asia/Tokyo \
  --env CI=true \
  --env PLAYWRIGHT_CHROMIUM_SANDBOX=1 \
  --env LIVE_CHROMIUM_SANDBOX=1 \
  --env LIVE_SITES \
  --env GITHUB_SHA \
  "$image" "$@"
