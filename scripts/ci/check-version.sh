#!/usr/bin/env bash
# The Teku inside the image is exactly the upstream version the repo pins.
#
#   scripts/ci/check-version.sh <image> <teku-version>
#
# Runs `teku --version` in the image (no node starts) and requires
# "teku/v<teku-version>/...". The image label org.opencontainers.image.version
# is printed as information.
set -euo pipefail

IMAGE=${1:?usage: check-version.sh <image> <teku-version>}
WANT=${2:?usage: check-version.sh <image> <teku-version>}

out=$(docker run --rm --platform linux/amd64 --entrypoint /opt/teku/bin/teku "$IMAGE" --version 2>&1 | head -5) || true
first=$(printf '%s\n' "$out" | grep -m1 '^teku/' || true)
label=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$IMAGE" 2>/dev/null || true)
echo "teku --version: ${first:-<no version line>}"
echo "image label org.opencontainers.image.version: ${label:-<none>}"
case "$first" in
"teku/v$WANT/"*)
  echo "PASS: the image runs Teku $WANT"
  ;;
*)
  echo "FAIL: expected Teku $WANT (teku/v$WANT/...), the image says: ${first:-$out}" >&2
  exit 1
  ;;
esac
