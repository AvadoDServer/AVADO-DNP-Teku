#!/usr/bin/env bash
# Render one network variant of the Teku package into a directory that the
# AVADOSDK can build as it is (the AVADOSDK knows nothing about variants).
#
#   scripts/render.sh <network> [out-dir]
#
# <network> is a folder in package_variants/ (mainnet, gnosis). out-dir must
# be empty, missing or an earlier render; default: a new temporary folder.
# The rendered folder's path is the only line printed on stdout:
#
#   dir=$(scripts/render.sh gnosis)
#   cd "$dir" && avadosdk build --provider <ipfs api>
#
# What it writes:
#   dappnode_package.json  the base manifest merged with the variant's (objects
#                          merge, arrays are replaced), plus "upstream" taken
#                          from TEKU_VERSION in the base docker-compose.yml
#   docker-compose.yml     the base compose merged with the variant's; the
#                          service is renamed to the package name and gets
#                          image <name>:<version>
#   avatar.png             the variant's avatar, copied as a regular file
#   build/                 the shared build context (files git tracks, plus
#                          new files that .gitignore does not exclude)
#
# Needs: bash, git, jq and yq v4 (github.com/mikefarah/yq).
set -euo pipefail

die() {
  echo "render.sh: $*" >&2
  exit 1
}
log() { echo "render.sh: $*" >&2; }

ROOT=$(cd "$(dirname "$0")/.." && pwd)
NETWORK=${1:-}
OUT=${2:-}
NETWORKS=$(cd "$ROOT/package_variants" && ls -d */ 2>/dev/null | tr -d / | tr '\n' ' ' | sed 's/ $//')

[ -n "$NETWORK" ] || die "usage: scripts/render.sh <network> [out-dir]   (networks: $NETWORKS)"
case "$NETWORK" in
*[!a-z0-9-]*) die "invalid network name '$NETWORK'" ;;
esac
VARIANT="$ROOT/package_variants/$NETWORK"
[ -d "$VARIANT" ] || die "unknown network '$NETWORK' (networks: $NETWORKS)"

command -v git >/dev/null || die "git is required"
command -v jq >/dev/null || die "jq is required"
command -v yq >/dev/null || die "yq v4 (github.com/mikefarah/yq) is required"
yq --version 2>&1 | grep -Eq 'mikefarah.*version v?4\.' || die "yq v4 (github.com/mikefarah/yq) is required, found: $(yq --version 2>&1)"

BASE_MANIFEST="$ROOT/dappnode_package.json"
BASE_COMPOSE="$ROOT/docker-compose.yml"
VARIANT_MANIFEST="$VARIANT/dappnode_package.json"
VARIANT_COMPOSE="$VARIANT/docker-compose.yml"
VARIANT_AVATAR="$VARIANT/avatar.png"
for f in "$BASE_MANIFEST" "$BASE_COMPOSE" "$VARIANT_MANIFEST" "$VARIANT_COMPOSE" "$VARIANT_AVATAR"; do
  [ -f "$f" ] || die "missing ${f#"$ROOT"/}"
done
[ -L "$VARIANT_AVATAR" ] && die "${VARIANT_AVATAR#"$ROOT"/} is a symlink; it must be a regular file"

# --- Invariants --------------------------------------------------------------

# Keys that identify a package on the boxes live only in the variants, so no
# network can inherit another network's identity from the base.
IDENTITY='["name","version","upstream","title","description","avatar","type","chain","ui","links"]'
IMAGE_IDENTITY='["ports","environment"]'
in_base=$(jq -r --argjson k "$IDENTITY" --argjson ik "$IMAGE_IDENTITY" \
  '[$k[] as $x | select(has($x)) | $x] + [$ik[] as $x | select((.image // {}) | has($x)) | "image.\($x)"] | join(" ")' \
  "$BASE_MANIFEST")
[ -z "$in_base" ] || die "the base dappnode_package.json must not set: $in_base (they belong in package_variants/<network>/)"

REQUIRED='["name","version","title","description","avatar","type","ui","links"]'
missing=$(jq -r --argjson k "$REQUIRED" --argjson ik "$IMAGE_IDENTITY" \
  '[$k[] as $x | select(has($x) | not) | $x] + [$ik[] as $x | select((.image // {}) | has($x) | not) | "image.\($x)"] | join(" ")' \
  "$VARIANT_MANIFEST")
[ -z "$missing" ] || die "package_variants/$NETWORK/dappnode_package.json lacks: $missing"
jq -e 'has("upstream") | not' "$VARIANT_MANIFEST" >/dev/null ||
  die "package_variants/$NETWORK/dappnode_package.json must not set \"upstream\": it is taken from TEKU_VERSION in the base docker-compose.yml"

NAME=$(jq -r '.name' "$VARIANT_MANIFEST")
VERSION=$(jq -r '.version' "$VARIANT_MANIFEST")
echo "$NAME" | grep -Eq '^[a-z0-9][a-z0-9.-]*$' || die "invalid package name '$NAME'"
echo "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || die "invalid package version '$VERSION'"

# The base compose has exactly one service; its TEKU_VERSION is the only place
# the upstream version is written.
[ "$(yq '.services | length' "$BASE_COMPOSE")" = 1 ] || die "the base docker-compose.yml must have exactly one service"
SERVICE=$(yq '.services | keys | .[0]' "$BASE_COMPOSE")
TEKU_VERSION=$(yq '.services[].build.args.TEKU_VERSION' "$BASE_COMPOSE")
echo "$TEKU_VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' ||
  die "TEKU_VERSION in the base docker-compose.yml must be a version like 26.9.0 (got '$TEKU_VERSION')"
TEKU_DIGEST=$(yq '.services[].build.args.TEKU_DIGEST' "$BASE_COMPOSE")
echo "$TEKU_DIGEST" | grep -Eq '^sha256:[0-9a-f]{64}$' ||
  die "TEKU_DIGEST in the base docker-compose.yml must be the sha256 digest of consensys/teku:$TEKU_VERSION (got '$TEKU_DIGEST')"

[ "$(yq '.services | keys | join(" ")' "$VARIANT_COMPOSE")" = "$SERVICE" ] ||
  die "package_variants/$NETWORK/docker-compose.yml must have exactly the service '$SERVICE' of the base compose"
[ "$(yq '.services[].build.args.NETWORK' "$VARIANT_COMPOSE")" = "$NETWORK" ] ||
  die "package_variants/$NETWORK/docker-compose.yml must set build.args.NETWORK: $NETWORK"
for key in '.services[].build.args.TEKU_VERSION' '.services[].build.args.TEKU_DIGEST' '.services[].image' '.services[].build.context'; do
  [ "$(yq "$key" "$VARIANT_COMPOSE")" = null ] ||
    die "package_variants/$NETWORK/docker-compose.yml must not set $key (it comes from the base compose)"
done

# --- Output folder -----------------------------------------------------------

MARKER=.avado-render
if [ -z "$OUT" ]; then
  OUT=$(mktemp -d "${TMPDIR:-/tmp}/teku-$NETWORK.XXXXXX")
elif [ -e "$OUT" ]; then
  [ -d "$OUT" ] || die "$OUT is not a folder"
  if [ -n "$(ls -A "$OUT")" ]; then
    [ -f "$OUT/$MARKER" ] || die "$OUT is not empty and is not an earlier render; refusing to write there"
    find "$OUT" -mindepth 1 -delete
  fi
else
  mkdir -p "$OUT"
fi
OUT=$(cd "$OUT" && pwd)
printf 'network=%s\nsource=%s\n' "$NETWORK" "$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)" >"$OUT/$MARKER"

# --- Manifest ----------------------------------------------------------------

# jq's "*" merges objects deeply and replaces arrays (an index-by-index array
# merge would mix the networks' ports and drop env entries). Keys are put in
# the order the published manifests have always had.
jq -n --slurpfile base "$BASE_MANIFEST" --slurpfile variant "$VARIANT_MANIFEST" --arg upstream "$TEKU_VERSION" '
  def ordered($keys): . as $o
    | (reduce ($keys[] | select(. as $k | $o | has($k))) as $k ({}; .[$k] = $o[$k])) + $o;
  ($base[0] * $variant[0]) + {upstream: $upstream}
  | .image |= ordered(["volumes", "ports", "environment", "restart"])
  | ordered(["name", "version", "upstream", "title", "description", "avatar", "type", "autoupdate",
             "image", "author", "license", "dependencies", "ui", "links"])
' >"$OUT/dappnode_package.json"

# --- Compose -----------------------------------------------------------------

# yq's "*" also merges maps deeply and replaces arrays.
NAME="$NAME" IMAGE="$NAME:$VERSION" yq eval-all '
  . as $doc ireduce ({}; . * $doc)
  | .services |= with_entries(.key = strenv(NAME))
  | .services[strenv(NAME)] = ({"image": strenv(IMAGE)} * .services[strenv(NAME)])
  | .services[strenv(NAME)].image style = "single"
  | ... comments = ""
' "$BASE_COMPOSE" "$VARIANT_COMPOSE" >"$OUT/docker-compose.yml"

# --- Avatar and build context --------------------------------------------------

cp "$VARIANT_AVATAR" "$OUT/avatar.png"

git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "$ROOT is not a git checkout"
(
  cd "$ROOT"
  git ls-files -z -co --exclude-standard -- build | while IFS= read -r -d '' f; do
    if [ -e "$f" ] || [ -L "$f" ]; then printf '%s\0' "$f"; fi
  done | COPYFILE_DISABLE=1 tar --null -T - -cf -
) | tar -C "$OUT" -xf -
[ -f "$OUT/build/Dockerfile" ] || die "the build context was not copied"

log "$NAME $VERSION (network $NETWORK, Teku $TEKU_VERSION) rendered to $OUT"
echo "$OUT"
