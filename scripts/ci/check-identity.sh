#!/usr/bin/env bash
# What identifies a package on the boxes did not change, and the version goes up.
#
#   scripts/ci/check-identity.sh <network> <base-ref> [out-dir]
#
# Boxes auto-update in place and cannot roll back, so an update must keep the
# package name, the volumes, the host ports, the set of environment keys, the
# type and the compose service and volume names. The variant rendered from HEAD
# is compared with
#   - the same variant rendered from <base-ref> (the branch the PR goes into;
#     before the package_variants layout: the root manifest with the same name),
#   - the manifest the production store serves for that name (if readable).
# Version rules: the version never goes down, and it must go up when anything
# that ends up in the package changed (build/, the compose files, the manifests).
set -euo pipefail

NETWORK=${1:?usage: check-identity.sh <network> <base-ref> [out-dir]}
BASE=${2:?usage: check-identity.sh <network> <base-ref> [out-dir]}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT=${3:-$(mktemp -d "${TMPDIR:-/tmp}/identity.XXXXXX")}
STORE_POINTER=${AVADO_STORE_POINTER:-https://bo.ava.do/value/store}
GATEWAYS=${AVADO_IPFS_GATEWAYS:-http://80.208.229.228:8080 https://ipfs.io}
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)

fails=0
: >"$OUT/result.tsv"
check() { # <PASS|FAIL|INFO> <name> <detail>
  printf '%s\t%s\t%s\n' "$1" "$2" "$3" >>"$OUT/result.tsv"
  printf '  %-5s %-22s %s\n' "$1" "$2" "$3"
  [ "$1" = FAIL ] && fails=$((fails + 1))
  return 0
}
semver_cmp() { # prints -1, 0 or 1
  local -a a b
  local i
  IFS=. read -ra a <<<"$1"
  IFS=. read -ra b <<<"$2"
  for i in 0 1 2; do
    if [ "${a[$i]:-0}" -lt "${b[$i]:-0}" ]; then echo -1; return; fi
    if [ "${a[$i]:-0}" -gt "${b[$i]:-0}" ]; then echo 1; return; fi
  done
  echo 0
}
# The facts that must not change, as sorted JSON.
identity() { # <manifest.json>
  jq -S '{name, type: (.type // null), volumes: (.image.volumes // []),
    ports: ((.image.ports // []) | sort), env_keys: ([(.image.environment // [])[] | split("=")[0]] | sort)}' "$1"
}
compose_identity() { # <compose.yml>
  yq -o=json '{"services": (.services | keys), "service_volumes": [.services[].volumes // [] | .[]], "volumes": ((.volumes // {}) | keys)}' "$1" | jq -S .
}

head_dir=$("$ROOT/scripts/render.sh" "$NETWORK" "$OUT/head")
H="$head_dir/dappnode_package.json"
name=$(jq -r .name "$H")
version=$(jq -r .version "$H")
echo "$name $version ($NETWORK) against $BASE"

# --- base -------------------------------------------------------------------------
B="" BC=""
if git -C "$ROOT" cat-file -e "$BASE:scripts/render.sh" 2>/dev/null &&
  git -C "$ROOT" cat-file -e "$BASE:package_variants/$NETWORK/dappnode_package.json" 2>/dev/null; then
  src="$OUT/base-src"
  rm -rf "$src"
  mkdir -p "$src"
  git -C "$ROOT" archive "$BASE" | tar -C "$src" -xf -
  git -C "$src" init -q && git -C "$src" add -A && git -C "$src" -c user.name=x -c user.email=x@x commit -qm base
  base_dir=$("$src/scripts/render.sh" "$NETWORK" "$OUT/base")
  B="$base_dir/dappnode_package.json"
  BC="$base_dir/docker-compose.yml"
  check INFO base "variant $NETWORK rendered from $BASE"
else
  for f in $(git -C "$ROOT" ls-tree --name-only "$BASE" | grep -E '^dappnode_package.*\.json$' || true); do
    if [ "$(git -C "$ROOT" show "$BASE:$f" | jq -r .name)" = "$name" ]; then
      git -C "$ROOT" show "$BASE:$f" >"$OUT/base-manifest.json"
      B="$OUT/base-manifest.json"
      check INFO base "$BASE has no package_variants/$NETWORK; compared with its $f (compose not compared)"
      break
    fi
  done
  [ -n "$B" ] || check INFO base "$name does not exist on $BASE: a new package, nothing to compare"
fi

if [ -n "$B" ]; then
  if diff -u <(identity "$B") <(identity "$H") >"$OUT/identity-vs-base.diff"; then
    check PASS identity-vs-base "name, type, volumes, ports and environment keys unchanged"
  else
    check FAIL identity-vs-base "changed: $(grep '^[-+] ' "$OUT/identity-vs-base.diff" | tr -s ' ' | tr '\n' ' ' | cut -c1-300)"
  fi
  if [ -n "$BC" ]; then
    if diff -u <(compose_identity "$BC") <(compose_identity "$head_dir/docker-compose.yml") >"$OUT/compose-vs-base.diff"; then
      check PASS compose-vs-base "service name and volumes unchanged"
    else
      check FAIL compose-vs-base "changed: $(grep '^[-+] ' "$OUT/compose-vs-base.diff" | tr -s ' ' | tr '\n' ' ' | cut -c1-300)"
    fi
  fi
  envdiff=$(diff <(jq -r '.image.environment[]?' "$B" | sort) <(jq -r '.image.environment[]?' "$H" | sort) | grep '^[<>]' | tr '\n' ' ' || true)
  [ -z "$envdiff" ] || check INFO env-defaults "default values changed (new installs only): $envdiff"

  base_version=$(jq -r .version "$B")
  cmp=$(semver_cmp "$version" "$base_version")
  # What boxes read is the manifest; "upstream" in it is the Teku version.
  manifest_changed=$(diff <(jq -S 'del(.version)' "$B") <(jq -S 'del(.version)' "$H") | grep '^[<>]' | tr -s ' ' | tr '\n' ' ' | cut -c1-200 || true)
  build_changed=$(git -C "$ROOT" diff --name-only "$BASE" HEAD -- build docker-compose.yml "package_variants/$NETWORK/docker-compose.yml" |
    head -5 | tr '\n' ' ' || true)
  if [ "$cmp" = -1 ]; then
    check FAIL version "$version is lower than $base_version on $BASE (versions only go up)"
  elif [ "$cmp" = 0 ] && [ -n "$manifest_changed" ]; then
    check FAIL version "still $version although the manifest changed ($manifest_changed); boxes only update to a higher version"
  elif [ "$cmp" = 0 ]; then
    check PASS version "$version, manifest unchanged: nothing will be released"
    [ -z "$build_changed" ] || check INFO build-files "changed without a new version ($build_changed): they reach boxes with the next version; the equivalence proof shows what differs from production"
  else
    check PASS version "$base_version -> $version"
  fi
fi

# --- production ---------------------------------------------------------------------
prod=""
if pointer=$(curl -fsS --max-time 30 -H 'Cache-Control: no-cache' "$STORE_POINTER" 2>/dev/null); then
  store_cid=$(printf '%s' "$pointer" | jq -r 'if type == "string" then fromjson else . end | .hash' 2>/dev/null || true)
  for gw in $GATEWAYS; do
    if [ -n "$store_cid" ] && curl -fsS --max-time 60 "$gw/ipfs/$store_cid" -o "$OUT/store.json" 2>/dev/null &&
      jq -e .packages "$OUT/store.json" >/dev/null 2>&1; then
      prod=$store_cid
      break
    fi
  done
fi
if [ -z "$prod" ]; then
  check INFO production "the production store could not be read; compared with $BASE only"
elif jq -e --arg n "$name" '[.packages[] | select(.manifest.name == $n)] | length == 1' "$OUT/store.json" >/dev/null; then
  jq --arg n "$name" '.packages[] | select(.manifest.name == $n) | .manifest' "$OUT/store.json" >"$OUT/production-manifest.json"
  prod_version=$(jq -r .version "$OUT/production-manifest.json")
  if diff -u <(identity "$OUT/production-manifest.json") <(identity "$H") >"$OUT/identity-vs-production.diff"; then
    check PASS identity-vs-production "same name, type, volumes, ports and environment keys as production $prod_version"
  else
    check FAIL identity-vs-production "differs from production $prod_version: $(grep '^[-+] ' "$OUT/identity-vs-production.diff" | tr -s ' ' | tr '\n' ' ' | cut -c1-300)"
  fi
  if [ "$(semver_cmp "$version" "$prod_version")" = -1 ]; then
    check FAIL version-vs-production "$version is lower than production $prod_version"
  else
    check PASS version-vs-production "$version, production has $prod_version"
  fi
else
  check INFO production "$name is not in the production store ($prod) yet"
fi

if [ "$fails" = 0 ]; then
  echo "PASS: $name keeps its identity"
else
  echo "FAIL: $fails identity check(s) failed for $name" >&2
  exit 1
fi
