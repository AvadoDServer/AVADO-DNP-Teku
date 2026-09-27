#!/usr/bin/env bash
# shellcheck disable=SC2154 # production_* and candidate_* are set by phase() through printf -v
# Upgrade in place, the way a box auto-updates: the production image (what boxes
# run today) starts on a fresh data volume, checkpoint-syncs and follows the
# chain for a few minutes, and is stopped; then the candidate image starts on
# the SAME volume, with the same environment.
#
#   scripts/ci/upgrade-test.sh <production-image> <candidate-image> <render-dir> <out-dir>
#
# <render-dir> is the variant folder scripts/render.sh wrote (environment and
# volume as the DAPPMANAGER uses them). The box stand-in is the one the boot
# test uses (scripts/ci/boot-mock.js).
#
# Passes when the candidate
#   - kept Teku's database: no fresh start ("Empty storage", "Loading initial
#     state from") and no database error ("Failed to initialize storage",
#     database version problems, DatabaseStorageException, "re-sync"),
#   - answers on its REST API and its head moves forward,
#   - kept /data/settings.json byte for byte,
#   - was started once by supervisord and never exited, with no fatal line.
# Exit code 0: pass. 1: a check failed. 2: only outside problems (production
# never followed the chain, or the candidate's head did not move: peers,
# checkpoint endpoint), so the workflow tries once more.
set -uo pipefail

PROD=${1:?usage: upgrade-test.sh <production-image> <candidate-image> <render-dir> <out-dir>}
CAND=${2:?usage: upgrade-test.sh <production-image> <candidate-image> <render-dir> <out-dir>}
RENDER=${3:?usage: upgrade-test.sh <production-image> <candidate-image> <render-dir> <out-dir>}
OUT=${4:?usage: upgrade-test.sh <production-image> <candidate-image> <render-dir> <out-dir>}
READY_MIN=${BOOT_READY_MINUTES:-10}
PROD_MIN=${UPGRADE_PRODUCTION_MINUTES:-3}
WATCH_MIN=${UPGRADE_WATCH_MINUTES:-3}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)

die() {
  echo "upgrade-test: $*" >&2
  exit 1
}
log() { echo "upgrade-test: $(date -u +%H:%M:%S) $*" >&2; }

NETWORK=$(yq '.services[].build.args.NETWORK' "$RENDER/docker-compose.yml")
case "$NETWORK" in
mainnet) CHAIN_HEX=0x1 ;;
gnosis) CHAIN_HEX=0x64 ;;
*) die "no upgrade-test settings for network '$NETWORK' (add them here)" ;;
esac
DEFAULTS="$RENDER/build/monitor/settings/defaultsettings-$NETWORK.json"
[ -f "$DEFAULTS" ] || die "missing $DEFAULTS"
EE_HOST=$(jq -r .ee_endpoint "$DEFAULTS" | sed -E 's#^[a-z]+://([^:/]+).*#\1#')
docker image inspect "$PROD" >/dev/null 2>&1 || die "production image $PROD not found (the equivalence proof loads it)"
docker image inspect "$CAND" >/dev/null 2>&1 || die "candidate image $CAND not found"

id="avado-upgrade-$NETWORK-$$"
NET="$id-net"
VOL="$id-data"
MOCK="$id-box"
cleanup() {
  docker rm -f "$id-production" "$id-candidate" "$MOCK" >/dev/null 2>&1
  docker network rm "$NET" >/dev/null 2>&1
  docker volume rm "$VOL" >/dev/null 2>&1
}
trap cleanup EXIT

# The environment exactly as the manifest gives it (a box on the defaults).
env_args=()
while IFS= read -r e; do
  if [ "${e%%=*}" = JAVA_OPTS ] && [ -r /proc/meminfo ]; then
    ram_gb=$(awk '/^MemTotal:/ {print int($2 / 1048576)}' /proc/meminfo)
    want_gb=$(echo "$e" | sed -nE 's/.*-Xmx([0-9]+)[gG].*/\1/p')
    if [ -n "$want_gb" ] && [ "$ram_gb" -lt $((want_gb + 4)) ]; then
      e=$(echo "$e" | sed -E "s/-Xmx[0-9]+[gG]/-Xmx$((ram_gb - 3))g/")
    fi
  fi
  env_args+=(-e "$e")
done < <(jq -r '.image.environment[]' "$RENDER/dappnode_package.json")
volume=$(jq -r '.image.volumes[0]' "$RENDER/dappnode_package.json")
[ "${volume#*:}" = /data ] || die "unexpected volume $volume"

docker network create "$NET" >/dev/null || die "cannot create a docker network"
docker volume create "$VOL" >/dev/null || die "cannot create a docker volume"
docker run -d --name "$MOCK" --network "$NET" --platform linux/amd64 \
  --network-alias dappmanager.my.ava.do --network-alias "$EE_HOST" \
  -e CHAIN_ID="$CHAIN_HEX" -v "$ROOT/scripts/ci/boot-mock.js:/boot-mock.js:ro" \
  --entrypoint /bin/sh "$CAND" -c 'exec /root/.nvm/versions/node/*/bin/node /boot-mock.js' >/dev/null ||
  die "cannot start the box stand-in"

# phase <label> <image> <watch minutes>: runs the image on the shared volume,
# waits for the REST API, watches the head, then stops it the way a box does.
# Sets <label>_ready, <label>_first, <label>_last, <label>_stop.
phase() {
  local label=$1 img=$2 watch=$3 c="$id-$1" started ready=0 h first="" last="" until
  log "$NETWORK: starting the $label image $img on the shared volume"
  started=$(date +%s)
  docker run -d --name "$c" --network "$NET" --platform linux/amd64 -v "$VOL:/data" "${env_args[@]}" "$img" >/dev/null ||
    die "cannot start the $label container"
  while [ $(($(date +%s) - started)) -lt $((READY_MIN * 60)) ]; do
    [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = true ] || break
    h=$(docker exec "$c" curl -s -m 10 http://localhost:5051/eth/v1/node/syncing 2>/dev/null | jq -r '.data.head_slot // empty' 2>/dev/null)
    if [ -n "$h" ]; then ready=1; first=$h; last=$h; break; fi
    sleep 10
  done
  if [ "$ready" = 1 ]; then
    log "$NETWORK: $label answered after $(($(date +%s) - started)) s at head slot $first; watching $watch minutes"
    until=$(($(date +%s) + watch * 60))
    while [ "$(date +%s)" -lt "$until" ]; do
      [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = true ] || break
      h=$(docker exec "$c" curl -s -m 10 http://localhost:5051/eth/v1/node/syncing 2>/dev/null | jq -r '.data.head_slot // empty' 2>/dev/null)
      [ -n "$h" ] && last=$h
      printf '%s\t%s\t%s\n' "$label" "$(date -u +%H:%M:%S)" "${h:--}" >>"$OUT/samples.tsv"
      sleep 20
    done
  fi
  local stop=no
  if docker stop -t 60 "$c" >/dev/null 2>&1; then stop=yes; fi
  docker logs "$c" >"$OUT/$label.log" 2>&1
  docker cp "$c:/data/settings.json" "$OUT/settings-after-$label.json" >/dev/null 2>&1 || : >"$OUT/settings-after-$label.json"
  printf -v "${label}_ready" '%s' "$ready"
  printf -v "${label}_first" '%s' "$first"
  printf -v "${label}_last" '%s' "$last"
  printf -v "${label}_stop" '%s' "$stop"
}

printf 'phase\ttime\thead_slot\n' >"$OUT/samples.tsv"
phase production "$PROD" "$PROD_MIN"
phase candidate "$CAND" "$WATCH_MIN"
docker logs "$MOCK" >"$OUT/box-standin.log" 2>&1

# --- verdict ------------------------------------------------------------------------
fails=0
outside_only=1
: >"$OUT/result.tsv"
check() { # <PASS|FAIL|INFO> <name> <detail> [outside]
  printf '%s\t%s\t%s\n' "$1" "$2" "$3" >>"$OUT/result.tsv"
  printf '  %-5s %-18s %s\n' "$1" "$2" "$3"
  if [ "$1" = FAIL ]; then
    fails=$((fails + 1))
    [ "${4:-}" = outside ] || outside_only=0
  fi
  return 0
}
clean() { sed 's/\x1b\[[0-9;]*m//g' "$1"; }

if [ "$production_ready" = 1 ] && [ -n "$production_last" ] && [ $((production_last - production_first)) -ge 2 ]; then
  check PASS production-ran "production followed the chain: head slot $production_first -> $production_last, stopped within 60 s: $production_stop"
else
  check FAIL production-ran "production did not follow the chain (head ${production_first:-?} -> ${production_last:-?}); the upgrade could not be tried" outside
fi
if clean "$OUT/production.log" | grep -q 'Empty storage'; then
  check INFO production-start "production started on an empty volume, as a new install"
fi

fresh=$(clean "$OUT/candidate.log" | grep -E 'Empty storage|Loading initial state from' | head -2 | cut -c1-160 | tr '\n' ' ')
kept=$(clean "$OUT/candidate.log" | grep -oE 'Storage initialization complete|Not loading specified initial state as chain data already exists' | sort -u | tr '\n' ' ')
if [ -n "$fresh" ]; then
  check FAIL kept-database "the candidate started over instead of using the database production wrote: $fresh"
else
  check PASS kept-database "the candidate opened the existing database (${kept:-no fresh-start line})"
fi
# Teku's own messages (26.9.0 storage and StatusLogger classes), case-insensitive.
DB_ERRORS='failed to initialize storage|DatabaseStorageException|incompatible database version|unrecognized database version|unhandled database version|unable to read database version|no database version file|re-sync will be required|database[^|]*corrupt|corrupt[^|]*database'
if clean "$OUT/candidate.log" | grep -Eiq "$DB_ERRORS"; then
  check FAIL database-errors "$(clean "$OUT/candidate.log" | grep -Ei "$DB_ERRORS" | head -3 | cut -c1-200 | tr '\n' ' ')"
else
  check PASS database-errors "no database error in the candidate's log"
fi
if [ "$candidate_ready" = 1 ]; then
  check PASS rest-api "the candidate answered at head slot $candidate_first (production stopped at $production_last)"
else
  check FAIL rest-api "the candidate's REST API did not answer within $READY_MIN minutes"
fi
if [ "$candidate_ready" = 1 ] && [ $((candidate_last - candidate_first)) -ge 2 ]; then
  check PASS head-moves "head slot $candidate_first -> $candidate_last"
else
  check FAIL head-moves "the candidate's head did not move forward (${candidate_first:-?} -> ${candidate_last:-?})" outside
fi
if [ -s "$OUT/settings-after-production.json" ] && cmp -s "$OUT/settings-after-production.json" "$OUT/settings-after-candidate.json"; then
  check PASS settings-kept "/data/settings.json is byte for byte what production left"
else
  check FAIL settings-kept "/data/settings.json changed or is missing after the candidate started (see settings-after-*.json)"
fi
spawned=$(grep -c "spawned: 'teku'" "$OUT/candidate.log" || true)
exited=$(grep -E "exited: teku |gave up: teku" "$OUT/candidate.log" | grep -v 'exit status 143' || true)
if [ "$spawned" = 1 ] && [ -z "$exited" ]; then
  check PASS process "supervisord started the candidate's Teku once and it kept running"
else
  check FAIL process "Teku was started $spawned time(s); $(echo "$exited" | head -2 | tr '\n' ' ')"
fi
FATAL='Unknown option|Invalid value for option|Missing required|OutOfMemoryError|Exception in thread "main"|Teku failed to start|Unable to start|FATAL|Fatal error|Error: Could not find or load main class|Address already in use'
if clean "$OUT/candidate.log" | grep -Eq "$FATAL"; then
  check FAIL fatal-lines "$(clean "$OUT/candidate.log" | grep -E "$FATAL" | head -3 | cut -c1-200 | tr '\n' ' ')"
else
  check PASS fatal-lines "no fatal line in the candidate's log"
fi
check INFO stop "the candidate stopped within 60 s: ${candidate_stop:-?}"

if [ "$fails" = 0 ]; then
  echo "PASS: $NETWORK upgraded in place from the production image"
  exit 0
fi
echo "FAIL: $fails upgrade check(s) failed for $NETWORK (logs: $OUT/production.log, $OUT/candidate.log)" >&2
echo "----- last 30 lines of the candidate's log" >&2
clean "$OUT/candidate.log" | tail -30 >&2
[ "$outside_only" = 1 ] && exit 2
exit 1
