#!/usr/bin/env bash
# shellcheck disable=SC2154 # production_*, candidate_* and downgrade_* are set by phase() through printf -v
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
#   - still has the validator key production held, and its slashing protection:
#     a throwaway key, new and random for every run (scripts/ci/test-keystore.mjs,
#     so there is no fixed key anyone could deposit to; the node also confirms
#     it is no validator before it is imported), is imported into production
#     through Teku's key manager API with a slashing protection record, the way
#     the wizard imports keys; the candidate must list the key, and Teku's own
#     export must still hold the record,
#   - was started once by supervisord and never exited, with no fatal line.
# Then, for information only (never a failure): going back. The production
# image starts once more on the volume the candidate wrote; the result says
# whether the older Teku still opens the newer database or a resync would be
# needed (boxes never auto-update to a lower version, so going back means a
# user reinstalling the old version, or a new version built with the old Teku).
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
DOWNGRADE_READY_MIN=${UPGRADE_DOWNGRADE_READY_MINUTES:-5}
DOWNGRADE_MIN=${UPGRADE_DOWNGRADE_MINUTES:-1}
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
  docker rm -f "$id-production" "$id-candidate" "$id-downgrade" "$MOCK" >/dev/null 2>&1
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

# --- the validator key ---------------------------------------------------------------
# A new random key for this run, made by the package image's own node (as the
# box stand-in). It is never deposited to, so it can never be a validator.
docker run --rm --platform linux/amd64 -v "$ROOT/scripts/ci/test-keystore.mjs:/test-keystore.mjs:ro" \
  --entrypoint /bin/sh "$CAND" -c 'exec /root/.nvm/versions/node/*/bin/node /test-keystore.mjs' >"$OUT/test-key.json" 2>"$OUT/test-key.err" ||
  die "could not make the throwaway validator key: $(head -c 300 "$OUT/test-key.err")"
KEYSTORE="$OUT/test-keystore.json"
jq -e '.keystore' "$OUT/test-key.json" >"$KEYSTORE" || die "the throwaway validator key is not readable: $(head -c 300 "$OUT/test-key.json")"
KEY_PASSWORD=$(jq -r .password "$OUT/test-key.json")
PUBKEY=$(jq -r .pubkey "$OUT/test-key.json")
[[ "$PUBKEY" =~ ^0x[0-9a-f]{96}$ ]] && [ -n "$KEY_PASSWORD" ] || die "the throwaway validator key has no public key or password"
log "$NETWORK: throwaway validator key for this run: $PUBKEY"
SP_SLOT=12345 SP_SOURCE=100 SP_TARGET=101 # the slashing protection record imported with it
key_imported="" key_note="" key_listed="" gvr=""

# keymanager <container> <method> <path> [json file]: Teku's key manager API as
# the monitor calls it (bearer token, TLS on 5052, the package's *.my.ava.do
# name: Teku refuses a TLS name its certificate does not cover, such as
# localhost); prints "<http code> <body>".
KM_HOST=$([ "$NETWORK" = mainnet ] && echo teku.my.ava.do || echo "teku-$NETWORK.my.ava.do")
keymanager() {
  local c=$1 m=$2 p=$3 f=${4:-}
  if [ -n "$f" ]; then docker cp "$f" "$c:/tmp/keymanager-request.json" >/dev/null 2>&1 || { echo "000 cannot copy the request"; return 0; }; fi
  docker exec -e M="$m" -e P="$p" -e F="${f:+/tmp/keymanager-request.json}" -e NET="$NETWORK" -e H="$KM_HOST" "$c" sh -c '
    t=/data/data-$NET/validator/key-manager/validator-api-bearer
    [ -s "$t" ] || { echo "000 no bearer token file $t"; exit 0; }
    out=$(curl -sk -m 60 -w "\n%{http_code}" -X "$M" -H "Authorization: Bearer $(cat "$t")" \
      -H "Content-Type: application/json" ${F:+--data @"$F"} --resolve "$H:5052:127.0.0.1" "https://$H:5052$P")
    printf "%s %s\n" "$(printf "%s\n" "$out" | tail -1)" "$(printf "%s\n" "$out" | sed "\$d" | tr -d "\n")"' 2>/dev/null ||
    echo "000 docker exec failed"
}

# keystores_have_key <container>: 0 when the key manager lists the test key
keystores_have_key() {
  local r
  r=$(keymanager "$1" GET /eth/v1/keystores)
  [ "${r%% *}" = 200 ] && echo "${r#* }" | jq -e --arg pk "$PUBKEY" 'any(.data[]?; .validating_pubkey == $pk)' >/dev/null 2>&1
}

# import_key <container>: imports the test key with its slashing protection
# record into the running production container. Sets key_imported (yes, no or
# outside) and key_note.
import_key() {
  local c=$1 i r n code req
  for i in $(seq 1 18); do
    r=$(keymanager "$c" GET /eth/v1/keystores)
    [ "${r%% *}" = 200 ] && break
    sleep 10
  done
  if [ "${r%% *}" != 200 ]; then
    key_imported=no key_note="production's key manager API did not answer within 3 minutes: $(echo "$r" | cut -c1-160)"
    return
  fi
  # Never import a key that is a validator on this network (a new random key
  # never is; this makes sure). Only a clear answer counts: HTTP 200 with a
  # list, empty for "not a validator"; an error body is not a "no". The
  # finalized state is the checkpoint the node started from, so it is there.
  r=$(docker exec "$c" curl -s -m 30 -w '\n%{http_code}' "http://localhost:5051/eth/v1/beacon/states/finalized/validators?id=$PUBKEY" 2>/dev/null)
  code=$(printf '%s\n' "$r" | tail -1)
  r=$(printf '%s\n' "$r" | sed '$d')
  n=$(printf '%s\n' "$r" | jq -r 'if (.data | type) == "array" then (.data | length | tostring) else "error" end' 2>/dev/null)
  if [ "$code" != 200 ] || [ -z "$n" ] || [ "$n" = error ]; then
    key_imported=outside key_note="could not ask the node whether the test key is a validator (HTTP ${code:-none}): $(echo "$r" | cut -c1-160)"
    return
  fi
  if [ "$n" != 0 ]; then
    key_imported=no key_note="the node says the new random test key $PUBKEY IS a validator on $NETWORK (it cannot be: look at the node's answer): not imported: $(echo "$r" | cut -c1-160)"
    return
  fi
  gvr=$(docker exec "$c" curl -s -m 30 http://localhost:5051/eth/v1/beacon/genesis 2>/dev/null | jq -r '.data.genesis_validators_root // empty' 2>/dev/null)
  [ -n "$gvr" ] || { key_imported=outside key_note="the node did not give its genesis_validators_root"; return; }
  req="$OUT/import-request.json"
  jq -n --rawfile ks "$KEYSTORE" --arg pw "$KEY_PASSWORD" --arg gvr "$gvr" --arg pk "$PUBKEY" \
    --arg slot "$SP_SLOT" --arg src "$SP_SOURCE" --arg tgt "$SP_TARGET" \
    '{keystores: [$ks], passwords: [$pw], slashing_protection: ({metadata: {interchange_format_version: "5", genesis_validators_root: $gvr},
      data: [{pubkey: $pk, signed_blocks: [{slot: $slot}], signed_attestations: [{source_epoch: $src, target_epoch: $tgt}]}]} | tojson)}' >"$req"
  r=$(keymanager "$c" POST /eth/v1/keystores "$req")
  echo "$r" >"$OUT/import-response.txt"
  if [ "${r%% *}" = 200 ] && echo "${r#* }" | jq -e '.data[0].status == "imported"' >/dev/null 2>&1 && keystores_have_key "$c"; then
    key_imported=yes key_note="production imported $PUBKEY with slashing protection (block slot $SP_SLOT, attestation $SP_SOURCE -> $SP_TARGET)"
  else
    key_imported=no key_note="production's key manager did not import the test key: $(echo "$r" | cut -c1-200)"
  fi
}

# phase <label> <image> <watch minutes> [ready minutes]: runs the image on the
# shared volume, waits for the REST API (default READY_MIN), watches the head,
# then stops it the way a box does.
# Sets <label>_ready, <label>_first, <label>_last, <label>_stop.
phase() {
  local label=$1 img=$2 watch=$3 ready_min=${4:-$READY_MIN} c="$id-$1" started ready=0 h first="" last="" until i
  log "$NETWORK: starting the $label image $img on the shared volume"
  started=$(date +%s)
  docker run -d --name "$c" --network "$NET" --platform linux/amd64 -v "$VOL:/data" "${env_args[@]}" "$img" >/dev/null ||
    die "cannot start the $label container"
  while [ $(($(date +%s) - started)) -lt $((ready_min * 60)) ]; do
    [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = true ] || break
    h=$(docker exec "$c" curl -s -m 10 http://localhost:5051/eth/v1/node/syncing 2>/dev/null | jq -r '.data.head_slot // empty' 2>/dev/null)
    if [ -n "$h" ]; then ready=1; first=$h; last=$h; break; fi
    sleep 10
  done
  if [ "$ready" = 1 ]; then
    log "$NETWORK: $label answered after $(($(date +%s) - started)) s at head slot $first; watching $watch minutes"
    if [ "$label" = production ]; then
      import_key "$c"
      log "$NETWORK: validator key: $key_imported ($key_note)"
    fi
    until=$(($(date +%s) + watch * 60))
    while [ "$(date +%s)" -lt "$until" ]; do
      [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = true ] || break
      h=$(docker exec "$c" curl -s -m 10 http://localhost:5051/eth/v1/node/syncing 2>/dev/null | jq -r '.data.head_slot // empty' 2>/dev/null)
      [ -n "$h" ] && last=$h
      printf '%s\t%s\t%s\n' "$label" "$(date -u +%H:%M:%S)" "${h:--}" >>"$OUT/samples.tsv"
      sleep 20
    done
  fi
  if [ "$label" = candidate ] && [ "$key_imported" = yes ]; then
    # Teku loads the keys when it starts; its key manager may answer a little
    # after the REST API.
    key_listed=no
    for i in $(seq 1 18); do
      if keystores_have_key "$c"; then key_listed=yes; break; fi
      [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = true ] || break
      sleep 10
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
# The candidate's own Teku reads the slashing protection data production left
# (both containers are stopped; run as the teku user, like the package).
if [ "$key_imported" = yes ]; then
  docker run --rm --platform linux/amd64 --user teku -v "$VOL:/data" --entrypoint /bin/sh "$CAND" -c \
    "/opt/teku/bin/teku slashing-protection export --data-path=/data/data-$NETWORK --to=/tmp/slashing-protection.json >/tmp/export.log 2>&1 && cat /tmp/slashing-protection.json || cat /tmp/export.log" \
    >"$OUT/slashing-protection-export.json" 2>&1 || true
fi
# Going back (information only, after every upgrade check has its data): the
# production image once more, on the database the candidate wrote.
downgrade_ready="" downgrade_first="" downgrade_last=""
if [ "$candidate_ready" = 1 ]; then
  phase downgrade "$PROD" "$DOWNGRADE_MIN" "$DOWNGRADE_READY_MIN"
fi
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
case "$key_imported" in
yes)
  check PASS key-imported "$key_note"
  if [ "$key_listed" = yes ]; then
    check PASS key-kept "the candidate's key manager lists $PUBKEY"
  else
    check FAIL key-kept "the candidate's key manager does not list the validator key production held ($PUBKEY)"
  fi
  if jq -e --arg pk "$PUBKEY" --arg gvr "$gvr" --argjson slot "$SP_SLOT" --argjson src "$SP_SOURCE" --argjson tgt "$SP_TARGET" '
    .metadata.genesis_validators_root == $gvr and
    any(.data[]; .pubkey == $pk
      and ([.signed_blocks[]?.slot | tonumber] | max // -1) >= $slot
      and ([.signed_attestations[]?.source_epoch | tonumber] | max // -1) >= $src
      and ([.signed_attestations[]?.target_epoch | tonumber] | max // -1) >= $tgt)' \
    "$OUT/slashing-protection-export.json" >/dev/null 2>&1; then
    check PASS slashing-protection "the candidate's Teku exports the record production held (block slot >= $SP_SLOT, attestation >= $SP_SOURCE -> $SP_TARGET)"
  else
    check FAIL slashing-protection "the slashing protection record production held is missing or lower in the candidate's export: $(head -c 300 "$OUT/slashing-protection-export.json" | tr '\n' ' ')"
  fi
  ;;
outside) check FAIL key-imported "$key_note" outside ;;
no) check FAIL key-imported "$key_note" ;;
*) check INFO key-imported "not tried: production did not answer" ;;
esac
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
# Going back: information for the owner, never a failure.
if [ -z "$downgrade_ready" ]; then
  check INFO going-back "not tried: the candidate never answered"
else
  back_errors=$(clean "$OUT/downgrade.log" | grep -Ei "$DB_ERRORS|$FATAL" | head -3 | cut -c1-200 | tr '\n' ' ')
  back_fresh=$(clean "$OUT/downgrade.log" | grep -E 'Empty storage|Loading initial state from' | head -1 | cut -c1-160)
  if [ -n "$back_errors" ]; then
    check INFO going-back "the production image could NOT use the database this build wrote: $back_errors; going back to the older Teku would need a resync (see downgrade.log)"
  elif [ -n "$back_fresh" ]; then
    check INFO going-back "the production image started over instead of using the database this build wrote ($back_fresh): going back to the older Teku would mean a resync from a checkpoint (see downgrade.log)"
  elif [ "$downgrade_ready" = 1 ]; then
    check INFO going-back "the production image opened the database this build wrote and answered at head slot $downgrade_first -> ${downgrade_last:-?}: going back to the older Teku keeps the database"
  else
    check INFO going-back "the production image did not answer within $DOWNGRADE_READY_MIN minutes on the database this build wrote: going back to the older Teku may need a resync (see downgrade.log)"
  fi
fi

if [ "$fails" = 0 ]; then
  echo "PASS: $NETWORK upgraded in place from the production image"
  exit 0
fi
echo "FAIL: $fails upgrade check(s) failed for $NETWORK (logs: $OUT/production.log, $OUT/candidate.log)" >&2
echo "----- last 30 lines of the candidate's log" >&2
clean "$OUT/candidate.log" | tail -30 >&2
[ "$outside_only" = 1 ] && exit 2
exit 1
