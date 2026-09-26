#!/usr/bin/env bash
# Equivalence proof for the package_variants layout.
#
# For each network variant it shows that what this repo renders and builds
# equals what customer boxes run today (the live production store), except for
# the differences written down in scripts/proof/expected/<network>/<check>.diff.
# Those files are reviewed in git: any other difference fails the proof.
#
#   scripts/prove-equivalence.sh [options] [network ...]      (default: every variant)
#
#   --manifests-only    only the manifest, compose and avatar checks (no image build)
#   --update-expected   write the differences found as the new expected files
#                       (then review them with git diff before committing)
#   --work DIR          working folder (default: a new temporary folder)
#
# Environment: PROOF_CACHE (folder for downloaded production images, reused
# between runs), PROOF_BUILDER (docker buildx builder), AVADO_STORE_POINTER,
# AVADO_IPFS_GATEWAYS (space separated).
#
# Nothing is published and no secret is used. Production is read from
# https://bo.ava.do/value/store and AVADO's IPFS gateway; every file fetched
# from IPFS is checked against its hash with kubo (ipfs add --only-hash), so
# the gateway does not have to be trusted.
#
# Checks for each network (name: what is compared):
#   manifest  the rendered dappnode_package.json vs the manifest the CI released
#             for the production version (the "Manifest hash" of its
#             "Release <name> <version>" commit, whose image must be the one the
#             production store serves). Build fields (image.path/hash/size,
#             builddate) are left out. Store-only edits (title, category) are
#             printed as information.
#   compose   the rendered docker-compose.yml vs the one at that release commit
#   avatar    avatar.png of the variant has the IPFS hash in the manifest
# Unless --manifests-only, the production image (downloaded, hash-checked,
# docker load) and the candidate image (built here for linux/amd64) are compared:
#   version   teku --version
#   config    image config: env, entrypoint, cmd, exposed ports, volumes, user, labels
#   files     AVADO's files in the image (start script, config templates, default
#             settings, supervisord and nginx config) with mode and owner
#   ui        every file of the wizard build and of the monitor (not node_modules)
#   start-*   what the start script hands to Teku (argv, env, config file,
#             settings) for each MODE and for a box that already has settings;
#             Teku and curl are replaced by stubs, so no node starts
#   runtime   the whole container under supervisord: the monitor's /network,
#             /name and /defaultsettings, and the wizard page served by nginx
# and hard checks on the candidate alone: Teku is exactly TEKU_VERSION, the UIs
# and default settings name the variant's network, the UI builds are present.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
PROOF="$ROOT/scripts/proof"
EXPECTED="$PROOF/expected"
STUBS="$PROOF/stubs"
STORE_POINTER=${AVADO_STORE_POINTER:-https://bo.ava.do/value/store}
GATEWAYS=${AVADO_IPFS_GATEWAYS:-http://80.208.229.228:8080 https://ipfs.io}
KUBO_IMAGE="ipfs/kubo:v0.25.0@sha256:9d917826eb669276040efb39cf6c68ae7463356a8e216eb13b278de00aa126be"
PLATFORM=linux/amd64

MANIFESTS_ONLY=0
UPDATE=0
WORK=""
NETWORKS=""
while [ $# -gt 0 ]; do
  case "$1" in
  --manifests-only) MANIFESTS_ONLY=1 ;;
  --update-expected) UPDATE=1 ;;
  --work) WORK=$2; shift ;;
  -h | --help) sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
  -*) echo "unknown option $1" >&2; exit 2 ;;
  *) NETWORKS="$NETWORKS $1" ;;
  esac
  shift
done
[ -n "$NETWORKS" ] || NETWORKS=$(cd "$ROOT/package_variants" && ls -d */ | tr -d / | tr '\n' ' ')

die() {
  echo "prove-equivalence: $*" >&2
  exit 1
}
log() { echo "prove-equivalence: $*" >&2; }

for tool in docker jq yq curl git diff; do
  command -v "$tool" >/dev/null || die "$tool is required"
done

if [ -z "$WORK" ]; then
  WORK=$(mktemp -d "${TMPDIR:-/tmp}/teku-proof.XXXXXX")
else
  mkdir -p "$WORK"
  WORK=$(cd "$WORK" && pwd)
fi
CACHE=${PROOF_CACHE:-$WORK/cache}
mkdir -p "$CACHE"
CACHE=$(cd "$CACHE" && pwd)
RESULTS="$WORK/results.tsv"
: >"$RESULTS"
log "working folder: $WORK"

# ---------------------------------------------------------------------------
# helpers

record() { # <network> <check> <PASS|FAIL|INFO|UPDATED> <detail>
  printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" >>"$RESULTS"
  printf '  %-7s %-24s %s\n' "$3" "$2" "$4" >&2
}

kubo_ready=0
cid_of() { # <file>: the IPFS hash (CIDv0, default chunker) the AVADOSDK and kubo give it
  if [ "$kubo_ready" = 0 ]; then
    docker image inspect "$KUBO_IMAGE" >/dev/null 2>&1 || docker pull -q "$KUBO_IMAGE" >/dev/null
    kubo_ready=1
  fi
  docker run --rm -v "$1:/f:ro" --entrypoint sh "$KUBO_IMAGE" \
    -c 'ipfs init -e >/dev/null 2>&1; ipfs add -Q --only-hash /f'
}

fetch_cid() { # <cid> <out-file> [max seconds]: download from a gateway and verify the hash
  local cid=${1#/ipfs/} out=$2 max=${3:-60} gw
  if [ -f "$out" ] && [ "$(cid_of "$out")" = "$cid" ]; then return 0; fi
  for gw in $GATEWAYS; do
    if curl -fsS --retry 2 --max-time "$max" "$gw/ipfs/$cid" -o "$out.part" 2>/dev/null; then
      if [ "$(cid_of "$out.part")" = "$cid" ]; then
        mv "$out.part" "$out"
        return 0
      fi
      log "$gw returned content that does not match $cid; trying the next gateway"
    fi
  done
  rm -f "$out.part"
  die "could not fetch $cid (with a matching hash) from: $GATEWAYS"
}

compare() { # <network> <check> <production-file> <candidate-file>
  local net=$1 check=$2 actual expected lines
  mkdir -p "$WORK/$net/diff"
  actual="$WORK/$net/diff/$check.diff"
  expected="$EXPECTED/$net/$check.diff"
  diff -u --label production --label candidate "$3" "$4" >"$actual" || true
  lines=$(awk 'NR > 2 && /^[-+]/' "$actual" | wc -l | tr -d ' ')
  if [ "$UPDATE" = 1 ]; then
    mkdir -p "$EXPECTED/$net"
    cp "$actual" "$expected"
    record "$net" "$check" UPDATED "expected difference written ($lines lines)"
    return 0
  fi
  [ -f "$expected" ] || expected=/dev/null
  if cmp -s "$actual" "$expected"; then
    if [ -s "$actual" ]; then
      record "$net" "$check" PASS "differs from production only as expected ($lines lines, see ${expected#"$ROOT"/})"
    else
      record "$net" "$check" PASS "same as production"
    fi
  else
    record "$net" "$check" FAIL "unexpected difference from production (full diff: $actual)"
    echo "----- $net/$check: expected difference vs found difference" >&2
    diff -u --label expected --label found "$expected" "$actual" | sed 's/^/    /' >&2 || true
  fi
}

assert() { # <network> <check> <condition-result 0|1> <detail>
  if [ "$3" = 0 ]; then record "$1" "$2" PASS "$4"; else record "$1" "$2" FAIL "$4"; fi
}

# ---------------------------------------------------------------------------
# production store (read once)

log "reading the production store pointer $STORE_POINTER"
pointer=$(curl -fsS --max-time 30 -H 'Cache-Control: no-cache' "$STORE_POINTER") || die "cannot read $STORE_POINTER"
STORE_CID=$(printf '%s' "$pointer" | jq -r 'if type == "string" then fromjson else . end | .hash')
[ -n "$STORE_CID" ] && [ "$STORE_CID" != null ] || die "the store pointer has no hash: $pointer"
fetch_cid "$STORE_CID" "$WORK/store.json"
log "production store $STORE_CID (hash verified)"

# ---------------------------------------------------------------------------
# images

build_candidate() { # <network> <render-dir> <tag>
  local args
  args=$(yq '.services[].build.args | to_entries | .[] | "--build-arg=" + .key + "=" + .value' "$2/docker-compose.yml")
  log "$1: building the candidate image for $PLATFORM ($(echo $args))"
  # shellcheck disable=SC2086
  docker buildx build ${PROOF_BUILDER:+--builder "$PROOF_BUILDER"} --load --platform "$PLATFORM" \
    $args -t "$3" "$2/build" >"$WORK/$1/candidate-build.log" 2>&1 ||
    { tail -40 "$WORK/$1/candidate-build.log" >&2; die "$1: candidate image build failed"; }
}

load_production() { # <network> <image cid> <image size> <tag>
  local file="$CACHE/${2#/ipfs/}.tar.xz" loaded
  log "$1: fetching the production image ${2#/ipfs/} ($3 bytes)"
  fetch_cid "$2" "$file" 1800
  [ "$(wc -c <"$file" | tr -d ' ')" = "$3" ] || die "$1: production image size differs from the manifest"
  loaded=$(docker load -i "$file" | sed -n 's/^Loaded image: //p' | tail -1)
  [ -n "$loaded" ] || die "$1: docker load did not report an image"
  docker tag "$loaded" "$4"
}

run_in() { # <image> <shell script>: run a script in the image as root, without its entrypoint
  docker run --rm --platform "$PLATFORM" --entrypoint /bin/sh "$1" -c "$2"
}

run_start_profile() { # <image> <env-file> <seed-dir or -> <extra docker args> <out-file>
  local seed=""
  [ "$3" = - ] || seed="-v $3:/seed:ro"
  # stdout and stderr go through one pipe inside the container, so the order is
  # stable; timeout ends a start script that would wait forever.
  # shellcheck disable=SC2086
  docker run --rm --platform "$PLATFORM" --user teku --entrypoint /bin/bash \
    --env-file "$2" -e STUB_EE_UP=all \
    -v "$STUBS/teku:/opt/teku/bin/teku:ro" -v "$STUBS/curl:/usr/local/bin/curl:ro" \
    -v "$STUBS/start.sh:/proof/start.sh:ro" $seed $4 "$1" \
    -c 'timeout 180 /proof/start.sh 2>&1 || echo "start script exit code $?"' >"$5" 2>&1 || true
}

runtime_facts() { # <image> <env-file> <out-file>
  local cid i ok=0
  cid=$(docker run -d --platform "$PLATFORM" --env-file "$2" "$1")
  for i in $(seq 1 120); do
    if [ -n "$(docker exec "$cid" curl -s -m 2 http://localhost:9999/ping 2>/dev/null)" ] &&
      [ "$(docker exec "$cid" curl -s -m 2 -o /dev/null -w '%{http_code}' http://localhost/ 2>/dev/null)" = 200 ]; then
      ok=1
      break
    fi
    sleep 2
  done
  {
    [ "$ok" = 1 ] || echo "monitor or nginx did not answer within 240 s"
    echo "monitor /ping: $(docker exec "$cid" curl -s -m 5 http://localhost:9999/ping)"
    echo "monitor /network: $(docker exec "$cid" curl -s -m 5 http://localhost:9999/network)"
    echo "monitor /name: $(docker exec "$cid" curl -s -m 5 http://localhost:9999/name)"
    echo "monitor /defaultsettings:"
    docker exec "$cid" curl -s -m 5 http://localhost:9999/defaultsettings | jq -S . 2>&1
    echo "wizard GET /: HTTP $(docker exec "$cid" curl -s -m 5 -o /dev/null -w '%{http_code}' http://localhost/)"
    echo "wizard page: $(docker exec "$cid" curl -s -m 5 http://localhost/ | grep -o '<title>[^<]*</title>\|static/js/main\.[0-9a-f]*\.js' | tr '\n' ' ')"
    echo "supervisor: $(docker exec "$cid" supervisorctl -c /etc/supervisord.conf status monitor nginx 2>&1 | awk '{print $1, $2}' | tr '\n' ' ')"
  } >"$3"
  docker rm -f "$cid" >/dev/null
}

image_facts() { # <image> <out-dir> <network> <render-dir>
  local img=$1 out=$2 net=$3 render=$4 profile mode envbase
  mkdir -p "$out"

  docker run --rm --platform "$PLATFORM" --entrypoint /opt/teku/bin/teku "$img" --version >"$out/version.txt" 2>&1 || true

  docker image inspect "$img" | jq -S '.[0] | {Architecture, Os,
    Config: (.Config | {Env, Entrypoint, Cmd, ExposedPorts, Volumes, User, WorkingDir, Labels})}' >"$out/config.json"

  run_in "$img" '
    for f in /etc/supervisord.conf /etc/nginx/nginx.conf /opt/teku/startTeku.sh /opt/teku/reload-certs.sh \
      /opt/teku/teku-config.template /opt/teku/teku-config-syncing-beacon.template \
      /opt/teku/teku-config-syncing-validator.template /opt/teku/defaultsettings.json /opt/teku/keystorePasswordFile; do
      if [ -f "$f" ]; then echo "### $f ($(stat -c "%a %U:%G" "$f"))"; cat "$f"; echo; else echo "### $f MISSING"; fi
    done
    for f in /opt/teku/my.ava.do.crt /opt/teku/my.ava.do.key /opt/teku/my.ava.do.p12 /opt/teku/avado.keystore; do
      if [ -s "$f" ]; then echo "### $f ($(stat -c "%a %U:%G" "$f")) present; content not compared (the certificate is renewed)"
      else echo "### $f MISSING"; fi
    done
    echo "### /data ($(stat -c "%a %U:%G" /data))"
    echo "### node $(/root/.nvm/versions/node/v18.15.0/bin/node --version)"
    echo "### $(id nginx)"
  ' >"$out/files.txt" 2>&1

  run_in "$img" '
    cd /usr/local/wizard && find . -type f -exec sha256sum {} + | LC_ALL=C sort -k2 | sed "s#  \./#  wizard/#"
    cd /usr/local/monitor && find . -path ./node_modules -prune -o -type f -exec sha256sum {} + | LC_ALL=C sort -k2 | sed "s#  \./#  monitor/#"
    sha256sum node_modules/.yarn-integrity | sed "s#  #  monitor/#"
    echo "monitor/node_modules: $(ls node_modules | wc -l) entries"
  ' >"$out/ui.txt" 2>&1

  # Environment the DAPPMANAGER gives the container: the manifest's image.environment.
  envbase="$WORK/$net/env-base"
  jq -r '.image.environment[] | select(startswith("MODE=") | not)' "$render/dappnode_package.json" >"$envbase"
  for mode in unset syncing zerosync; do
    cp "$envbase" "$WORK/$net/env-$mode"
    [ "$mode" = unset ] || echo "MODE=$mode" >>"$WORK/$net/env-$mode"
    run_start_profile "$img" "$WORK/$net/env-$mode" - "" "$out/start-mode-$mode.txt"
  done

  # A box that already has settings: fee recipient, MEV-Boost, own graffiti and
  # peer bounds, an old JAVA_OPTS default (-Xmx3g) and user EXTRA_OPTS.
  profile="$WORK/$net/seed"
  mkdir -p "$profile"
  jq '.validators_graffiti = "proof-graffiti"
    | .validators_proposer_default_fee_recipient = "0x1111111111111111111111111111111111111111"
    | .mev_boost = true | .p2p_peer_lower_bound = 32 | .p2p_peer_upper_bound = 48' \
    "$ROOT/build/monitor/settings/defaultsettings-$net.json" >"$profile/settings.json"
  {
    echo "JAVA_OPTS=-Xmx3g"
    echo "EXTRA_OPTS=--p2p-subscribe-all-subnets-enabled=true --log-destination=CONSOLE"
    jq -r '.image.environment[] | select(startswith("MODE="))' "$render/dappnode_package.json"
  } >"$WORK/$net/env-existing"
  run_start_profile "$img" "$WORK/$net/env-existing" "$profile" \
    "--add-host $(jq -r '.ee_endpoint' "$profile/settings.json" | sed -E 's#^[a-z]+://([^:/]+).*#\1#'):127.0.0.1" \
    "$out/start-existing-settings.txt"

  cp "$envbase" "$WORK/$net/env-runtime"
  jq -r '.image.environment[] | select(startswith("MODE="))' "$render/dappnode_package.json" >>"$WORK/$net/env-runtime"
  runtime_facts "$img" "$WORK/$net/env-runtime" "$out/runtime.txt"
}

# ---------------------------------------------------------------------------
# per network

TEKU_VERSION=$(yq '.services[].build.args.TEKU_VERSION' "$ROOT/docker-compose.yml")

for net in $NETWORKS; do
  echo >&2
  log "=== $net"
  mkdir -p "$WORK/$net"
  render=$("$ROOT/scripts/render.sh" "$net" "$WORK/$net/render")
  name=$(jq -r .name "$render/dappnode_package.json")
  version=$(jq -r .version "$render/dappnode_package.json")
  echo "$name $version ($net)" >&2

  # Production: the store entry, its manifest and the CI release it came from.
  jq --arg n "$name" '[.packages[] | select(.manifest.name == $n)] | if length == 1 then .[0] else error("\(length) store entries for \($n)") end' \
    "$WORK/store.json" >"$WORK/$net/store-entry.json" || die "$name is not (exactly once) in the production store"
  fetch_cid "$(jq -r .manifesthash "$WORK/$net/store-entry.json")" "$WORK/$net/production-store-manifest.json"
  prod_version=$(jq -r .version "$WORK/$net/production-store-manifest.json")
  prod_image=$(jq -r .image.hash "$WORK/$net/production-store-manifest.json")
  prod_size=$(jq -r .image.size "$WORK/$net/production-store-manifest.json")

  release=""
  for sha in $(git -C "$ROOT" log --all --author='github-actions' -F --grep="Release $name $prod_version" --format=%H); do
    if [ "$(git -C "$ROOT" log -1 --format=%s "$sha")" = "Release $name $prod_version" ]; then
      release=$sha
      break
    fi
  done
  [ -n "$release" ] || die "no CI commit \"Release $name $prod_version\" in the git history (CI: check out with fetch-depth: 0)"
  ci_manifest=$(git -C "$ROOT" log -1 --format=%B "$release" | sed -n 's/^Manifest hash: *//p' | head -1)
  [ -n "$ci_manifest" ] || die "commit $release has no \"Manifest hash:\" line"
  fetch_cid "$ci_manifest" "$WORK/$net/production-ci-manifest.json"
  git -C "$ROOT" show "$release:docker-compose.yml" >"$WORK/$net/production-compose.yml"

  [ "$(jq -r .image.hash "$WORK/$net/production-ci-manifest.json")" = "$prod_image" ] ||
    die "$name: the production store serves another build than release commit $release"
  record "$net" production INFO "store $STORE_CID: $name $prod_version, image ${prod_image#/ipfs/}, release commit ${release:0:7}"
  record "$net" store-only-fields INFO "$(jq -c '{title, avadocategory}' "$WORK/$net/production-store-manifest.json") (set in editstore; the release manifest says $(jq -c .title "$WORK/$net/production-ci-manifest.json"))"

  # manifest and compose
  jq 'del(.image.path, .image.hash, .image.size, .builddate)' "$WORK/$net/production-ci-manifest.json" >"$WORK/$net/manifest.production.json"
  jq . "$render/dappnode_package.json" >"$WORK/$net/manifest.candidate.json"
  compare "$net" manifest "$WORK/$net/manifest.production.json" "$WORK/$net/manifest.candidate.json"
  yq -o=json "$WORK/$net/production-compose.yml" >"$WORK/$net/compose.production.json"
  yq -o=json "$render/docker-compose.yml" >"$WORK/$net/compose.candidate.json"
  compare "$net" compose "$WORK/$net/compose.production.json" "$WORK/$net/compose.candidate.json"

  avatar_cid=$(cid_of "$render/avatar.png")
  if [ "/ipfs/$avatar_cid" = "$(jq -r .avatar "$render/dappnode_package.json")" ]; then r=0; else r=1; fi
  assert "$net" avatar $r "avatar.png is /ipfs/$avatar_cid; manifest: $(jq -r .avatar "$render/dappnode_package.json"); production: $(jq -r .avatar "$WORK/$net/production-store-manifest.json")"

  up=$(jq -r .upstream "$render/dappnode_package.json")
  if [ "$up" = "$TEKU_VERSION" ] && [ "$(yq '.services[].build.args.TEKU_VERSION' "$render/docker-compose.yml")" = "$TEKU_VERSION" ]; then r=0; else r=1; fi
  assert "$net" upstream-version $r "manifest upstream $up and build arg both come from TEKU_VERSION $TEKU_VERSION"

  [ "$MANIFESTS_ONLY" = 1 ] && continue

  # images
  prod_tag="avado-proof/production-$net:latest"
  cand_tag="avado-proof/candidate-$net:latest"
  load_production "$net" "$prod_image" "$prod_size" "$prod_tag"
  build_candidate "$net" "$render" "$cand_tag"
  log "$net: collecting facts from the production image"
  image_facts "$prod_tag" "$WORK/$net/production" "$net" "$render"
  log "$net: collecting facts from the candidate image"
  image_facts "$cand_tag" "$WORK/$net/candidate" "$net" "$render"
  for check in version config files ui start-mode-unset start-mode-syncing start-mode-zerosync start-existing-settings runtime; do
    ext=txt
    [ "$check" = config ] && ext=json
    compare "$net" "$check" "$WORK/$net/production/$check.$ext" "$WORK/$net/candidate/$check.$ext"
  done

  # hard checks on the candidate alone
  c="$WORK/$net/candidate"
  if grep -q "^teku/v$TEKU_VERSION/" "$c/version.txt"; then r=0; else r=1; fi
  assert "$net" candidate-teku $r "teku --version: $(head -1 "$c/version.txt")"
  if [ "$(jq -r .Architecture "$c/config.json")" = amd64 ]; then r=0; else r=1; fi
  assert "$net" candidate-platform $r "image is linux/$(jq -r .Architecture "$c/config.json")"
  if grep -q "^monitor /network: \"$net\"$" "$c/runtime.txt" && grep -q '^monitor /name: "teku"$' "$c/runtime.txt"; then r=0; else r=1; fi
  assert "$net" candidate-monitor $r "monitor answers $(grep -E '^monitor /(network|name):' "$c/runtime.txt" | tr '\n' ' ')"
  if grep -q "^wizard GET /: HTTP 200$" "$c/runtime.txt" && grep -q 'static/js/main\.[0-9a-f]*\.js' "$c/runtime.txt"; then r=0; else r=1; fi
  assert "$net" candidate-wizard $r "$(grep '^wizard' "$c/runtime.txt" | tr '\n' ' ')"
  # The wizard bundle embeds server_config.json as JSON.parse('{"<a>":"<network>","<b>":"teku"}').
  if docker run --rm -i --platform "$PLATFORM" --entrypoint /bin/sh "$cand_tag" -s "$net" >/dev/null 2>&1 <<'CHECK'
net=$1
jq -e -s --arg n "$net" 'all(.[]; .network == $n)' /opt/teku/defaultsettings.json /usr/local/monitor/build/settings/defaultsettings.json &&
  jq -e --arg n "$net" '.network == $n and .name == "teku"' /usr/local/monitor/build/server_config.json &&
  grep -Eq "JSON\.parse\('\{\"[^\"]+\":\"$net\",\"[^\"]+\":\"teku\"\}'\)" /usr/local/wizard/static/js/main.*.js &&
  test -s /usr/local/wizard/index.html && test -s /usr/local/monitor/build/server.js
CHECK
  then r=0; else r=1; fi
  assert "$net" candidate-network-config $r "default settings, monitor config and wizard bundle all name network $net"
  for mode in unset syncing zerosync; do
    if grep -q "^network: \"$net\"$" "$c/start-mode-$mode.txt" && grep -q '^=== teku start$' "$c/start-mode-$mode.txt"; then r=0; else r=1; fi
    assert "$net" "candidate-start-$mode" $r "MODE=$mode: the start script starts Teku with network $net"
  done
done

# ---------------------------------------------------------------------------
# summary

echo >&2
fails=$(awk -F'\t' '$3 == "FAIL"' "$RESULTS" | wc -l | tr -d ' ')
passes=$(awk -F'\t' '$3 == "PASS"' "$RESULTS" | wc -l | tr -d ' ')
if [ "$UPDATE" = 1 ]; then
  log "expected differences written to ${EXPECTED#"$ROOT"/}; review them with git diff ($fails failed hard checks)"
  [ "$fails" = 0 ]
elif [ "$fails" = 0 ]; then
  log "PASS: $passes checks passed for:$NETWORKS (details: $RESULTS)"
else
  log "FAIL: $fails of $((fails + passes)) checks failed (details: $RESULTS)"
  awk -F'\t' '$3 == "FAIL" {print "  " $1 " " $2 ": " $4}' "$RESULTS" >&2
  exit 1
fi
