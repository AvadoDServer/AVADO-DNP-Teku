#!/usr/bin/env bash
# The Teku base image is pinned: docker-compose.yml has TEKU_VERSION and
# TEKU_DIGEST, and the Dockerfile builds FROM consensys/teku:<version>@<digest>.
# This check compares the committed digest with what Docker Hub serves for that
# version now. A difference means the tag was moved or re-pushed after the bump:
# the build still uses the committed digest, but a person should look.
#
#   scripts/ci/check-digest.sh
#
# Docker Hub not answering is reported as a warning, not a failure (the build
# itself proves the pinned image exists).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
version=$(yq '.services[].build.args.TEKU_VERSION' "$ROOT/docker-compose.yml")
digest=$(yq '.services[].build.args.TEKU_DIGEST' "$ROOT/docker-compose.yml")
echo "$digest" | grep -Eq '^sha256:[0-9a-f]{64}$' || { echo "FAIL: TEKU_DIGEST '$digest' is not a sha256 digest" >&2; exit 1; }
if ! hub=$(curl -fsS --retry 3 --max-time 30 "https://hub.docker.com/v2/repositories/consensys/teku/tags/$version" | jq -r '.digest // empty'); then
  echo "::warning::Docker Hub did not answer; the digest of consensys/teku:$version was not compared (the build uses the committed $digest)"
  exit 0
fi
if [ "$hub" = "$digest" ]; then
  echo "PASS: consensys/teku:$version is $digest on Docker Hub, as committed"
else
  echo "FAIL: consensys/teku:$version is ${hub:-missing} on Docker Hub now, but docker-compose.yml pins $digest. The tag was moved or re-pushed: find out why before releasing." >&2
  exit 1
fi
