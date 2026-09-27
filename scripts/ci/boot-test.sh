#!/usr/bin/env bash
# Boots the package image on its real network with the package's real command
# line and watches it for a few minutes.
#
#   scripts/ci/boot-test.sh <image> <render-dir> <out-dir>
#
# <render-dir> is the variant folder scripts/render.sh wrote (its manifest gives
# the environment, ports and volume the DAPPMANAGER would use). The container
# runs its own entrypoint (supervisord -> startTeku.sh -> teku) with a fresh
# data volume, like a new install. A second container stands in for the box:
# dappmanager.my.ava.do serves the JWT secret and the execution engine host of
# the network's default settings answers like an execution client that is still
# syncing (scripts/ci/boot-mock.js).
#
# Passes when, within BOOT_READY_MINUTES (default 10) of the start and then
# BOOT_MINUTES (default 4) of watching:
#   - Teku's REST API answers and names the right network (CONFIG_NAME and
#     DEPOSIT_CHAIN_ID of mainnet or gnosis),
#   - it started from a checkpoint (its first head is within 10 epochs of the
#     current slot, not at genesis),
#   - the head moved forward while watching,
#   - it had at least BOOT_MIN_PEERS peers (default 3 on mainnet, 2 on gnosis:
#     a GitHub runner cannot accept inbound connections and Gnosis has few
#     public peers; the head moving forward is the real proof of working P2P),
#     counted from the REST API samples and from Teku's own status lines,
#   - supervisord started Teku once and it never exited, and no fatal line
#     (unknown option, out of memory, "Teku failed to start", ...) was logged,
#   - every UDP port Teku listens on (discovery, QUIC) is published by the
#     manifest, so peers can reach it (for example QUIC, on by default since
#     Teku 26.7.0 on 9001/udp).
# Logs, samples and the command line Teku ran with are written to <out-dir>.
# Exit code 0: pass. 1: a check failed. 2: only checks that depend on the
# public network failed (checkpoint sync, peers, head moving), so the workflow
# tries once more on a fresh volume before it reports a failure.
set -uo pipefail

IMAGE=${1:?usage: boot-test.sh <image> <render-dir> <out-dir>}
RENDER=${2:?usage: boot-test.sh <image> <render-dir> <out-dir>}
OUT=${3:?usage: boot-test.sh <image> <render-dir> <out-dir>}
READY_MIN=${BOOT_READY_MINUTES:-10}
WATCH_MIN=${BOOT_MINUTES:-4}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)

die() {
  echo "boot-test: $*" >&2
  exit 1
}
log() { echo "boot-test: $(date -u +%H:%M:%S) $*" >&2; }

NETWORK=$(yq '.services[].build.args.NETWORK' "$RENDER/docker-compose.yml")
case "$NETWORK" in
mainnet) WANT_CONFIG=mainnet WANT_CHAIN=1 CHAIN_HEX=0x1 MIN_PEERS=${BOOT_MIN_PEERS:-3} ;;
gnosis) WANT_CONFIG=gnosis WANT_CHAIN=100 CHAIN_HEX=0x64 MIN_PEERS=${BOOT_MIN_PEERS:-2} ;;
*) die "no boot-test expectations for network '$NETWORK' (add them here)" ;;
esac
DEFAULTS="$RENDER/build/monitor/settings/defaultsettings-$NETWORK.json"
[ -f "$DEFAULTS" ] || die "missing $DEFAULTS"
EE_HOST=$(jq -r .ee_endpoint "$DEFAULTS" | sed -E 's#^[a-z]+://([^:/]+).*#\1#')

id="avado-boot-$NETWORK-$$"
NET="$id-net"
VOL="$id-data"
TEKU="$id-teku"
MOCK="$id-box"
cleanup() {
  docker rm -f "$TEKU" "$MOCK" >/dev/null 2>&1
  docker network rm "$NET" >/dev/null 2>&1
  docker volume rm "$VOL" >/dev/null 2>&1
}
trap cleanup EXIT

# Environment and ports exactly as the manifest gives them to the DAPPMANAGER.
env_args=()
while IFS= read -r e; do
  if [ "${e%%=*}" = JAVA_OPTS ] && [ -r /proc/meminfo ]; then
    # A runner smaller than the heap the manifest asks for would kill Java; public
    # GitHub runners (16 GB) keep the manifest value.
    ram_gb=$(awk '/^MemTotal:/ {print int($2 / 1048576)}' /proc/meminfo)
    want_gb=$(echo "$e" | sed -nE 's/.*-Xmx([0-9]+)[gG].*/\1/p')
    if [ -n "$want_gb" ] && [ "$ram_gb" -lt $((want_gb + 4)) ]; then
      cap=$((ram_gb - 3))
      log "NOTE: this runner has ${ram_gb} GB RAM; JAVA_OPTS -Xmx${want_gb}g lowered to -Xmx${cap}g for the test"
      e=$(echo "$e" | sed -E "s/-Xmx[0-9]+[gG]/-Xmx${cap}g/")
    fi
  fi
  env_args+=(-e "$e")
done < <(jq -r '.image.environment[]' "$RENDER/dappnode_package.json")
port_args=()
while IFS= read -r p; do port_args+=(-p "$p"); done < <(jq -r '.image.ports[]' "$RENDER/dappnode_package.json")
volume=$(jq -r '.image.volumes[0]' "$RENDER/dappnode_package.json")
[ "${volume#*:}" = /data ] || die "unexpected volume $volume"

docker network create "$NET" >/dev/null || die "cannot create a docker network"
docker volume create "$VOL" >/dev/null || die "cannot create a docker volume"
docker run -d --name "$MOCK" --network "$NET" --platform linux/amd64 \
  --network-alias dappmanager.my.ava.do --network-alias "$EE_HOST" \
  -e CHAIN_ID="$CHAIN_HEX" -v "$ROOT/scripts/ci/boot-mock.js:/boot-mock.js:ro" \
  --entrypoint /bin/sh "$IMAGE" -c 'exec /root/.nvm/versions/node/*/bin/node /boot-mock.js' >/dev/null ||
  die "cannot start the box stand-in"
log "$NETWORK: starting $IMAGE (env: $(jq -rc '.image.environment' "$RENDER/dappnode_package.json"), ports: $(jq -rc '.image.ports' "$RENDER/dappnode_package.json"), execution engine stand-in: $EE_HOST)"
started=$(date +%s)
docker run -d --name "$TEKU" --network "$NET" --platform linux/amd64 -v "$VOL:/data" \
  "${env_args[@]}" "${port_args[@]}" "$IMAGE" >/dev/null || die "cannot start the Teku container"

api() { docker exec "$TEKU" curl -s -m 10 "http://localhost:5051$1" 2>/dev/null; }
running() { [ "$(docker inspect -f '{{.State.Running}}' "$TEKU" 2>/dev/null)" = true ]; }

# --- wait for the REST API -------------------------------------------------------
ready=0
while [ $(($(date +%s) - started)) -lt $((READY_MIN * 60)) ]; do
  running || break
  head=$(api /eth/v1/node/syncing | jq -r '.data.head_slot // empty' 2>/dev/null)
  if [ -n "$head" ]; then
    ready=1
    break
  fi
  sleep 10
done
ready_after=$(($(date +%s) - started))

spec=$(api /eth/v1/config/spec)
genesis=$(api /eth/v1/beacon/genesis | jq -r '.data.genesis_time // empty' 2>/dev/null)
config_name=$(echo "$spec" | jq -r '.data.CONFIG_NAME // empty' 2>/dev/null)
chain_id=$(echo "$spec" | jq -r '.data.DEPOSIT_CHAIN_ID // empty' 2>/dev/null)
sps=$(echo "$spec" | jq -r '.data.SECONDS_PER_SLOT // empty' 2>/dev/null)
spe=$(echo "$spec" | jq -r '.data.SLOTS_PER_EPOCH // empty' 2>/dev/null)
echo "$spec" | jq . >"$OUT/spec.json" 2>/dev/null

# --- watch ------------------------------------------------------------------------
printf 'time\tseconds\thead_slot\tcurrent_slot\tsync_distance\tis_optimistic\tel_offline\tpeers\n' >"$OUT/samples.tsv"
first_head="" last_head="" first_current="" max_peers=0
if [ "$ready" = 1 ]; then
  log "$NETWORK: REST API answered after ${ready_after} s; watching for $WATCH_MIN minutes"
  watch_until=$(($(date +%s) + WATCH_MIN * 60))
  while [ "$(date +%s)" -lt "$watch_until" ]; do
    running || break
    s=$(api /eth/v1/node/syncing)
    h=$(echo "$s" | jq -r '.data.head_slot // empty' 2>/dev/null)
    peers=$(api /eth/v1/node/peer_count | jq -r '.data.connected // empty' 2>/dev/null)
    now=$(date +%s)
    cur=""
    [ -n "$genesis" ] && [ -n "$sps" ] && cur=$(((now - genesis) / sps))
    if [ -n "$h" ]; then
      [ -n "$first_head" ] || { first_head=$h; first_current=$cur; }
      last_head=$h
    fi
    [ -n "$peers" ] && [ "$peers" -gt "$max_peers" ] && max_peers=$peers
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$(date -u +%H:%M:%S)" $((now - started)) "${h:--}" "${cur:--}" \
      "$(echo "$s" | jq -r '.data.sync_distance // "-"' 2>/dev/null)" "$(echo "$s" | jq -r '.data.is_optimistic // "-"' 2>/dev/null)" \
      "$(echo "$s" | jq -r '.data.el_offline // "-"' 2>/dev/null)" "${peers:--}" >>"$OUT/samples.tsv"
    sleep 20
  done
fi

# What Teku really runs with: the command line of every Java process, the
# generated config and the settings file.
docker exec "$TEKU" sh -c 'for p in $(pgrep java); do tr "\0" " " </proc/$p/cmdline; echo; done' >"$OUT/cmdline.txt" 2>&1
docker exec "$TEKU" sh -c 'cat /proc/net/udp /proc/net/udp6 2>/dev/null' >"$OUT/udp.txt" 2>&1
docker exec "$TEKU" sh -c 'cat /data/config.yml; echo "--- /data/settings.json"; cat /data/settings.json' >"$OUT/config.txt" 2>&1
monitor_network=$(docker exec "$TEKU" curl -s -m 5 http://localhost:9999/network 2>/dev/null)
stopped_clean=unknown
if running; then
  log "$NETWORK: stopping the container (60 s grace)"
  if docker stop -t 60 "$TEKU" >/dev/null 2>&1; then stopped_clean=yes; else stopped_clean=no; fi
fi
docker logs "$TEKU" >"$OUT/container.log" 2>&1
docker logs "$MOCK" >"$OUT/box-standin.log" 2>&1

# --- verdict ------------------------------------------------------------------------
fails=0
outside_only=1
: >"$OUT/result.tsv"
check() { # <PASS|FAIL|INFO> <name> <detail>
  printf '%s\t%s\t%s\n' "$1" "$2" "$3" >>"$OUT/result.tsv"
  printf '  %-5s %-16s %s\n' "$1" "$2" "$3"
  if [ "$1" = FAIL ]; then
    fails=$((fails + 1))
    case "$2" in checkpoint-sync | head-moves | peers) ;; *) outside_only=0 ;; esac
  fi
  return 0
}

if [ "$ready" = 1 ]; then check PASS rest-api "answered after ${ready_after} s"; else check FAIL rest-api "no answer from Teku's REST API within $READY_MIN minutes"; fi
if [ "$config_name" = "$WANT_CONFIG" ] && [ "$chain_id" = "$WANT_CHAIN" ]; then
  check PASS network "CONFIG_NAME $config_name, DEPOSIT_CHAIN_ID $chain_id"
else
  check FAIL network "expected $WANT_CONFIG / chain $WANT_CHAIN, Teku says ${config_name:-?} / ${chain_id:-?}"
fi
if [ -n "$first_head" ] && [ -n "$first_current" ] && [ -n "$spe" ] && [ $((first_current - first_head)) -le $((10 * spe)) ]; then
  check PASS checkpoint-sync "first head slot $first_head, current slot $first_current (started from a recent checkpoint)"
else
  check FAIL checkpoint-sync "first head slot ${first_head:-?} vs current slot ${first_current:-?}: not started from a recent checkpoint"
fi
if [ -n "$first_head" ] && [ -n "$last_head" ] && [ $((last_head - first_head)) -ge 2 ]; then
  check PASS head-moves "head slot $first_head -> $last_head while watching"
else
  check FAIL head-moves "head slot did not move forward (${first_head:-?} -> ${last_head:-?})"
fi
# Teku logs its peer count every few seconds ("Connected peers: N" while
# syncing, "Peers: N" in sync); the REST samples above are every 20 s.
log_peers=$(sed 's/\x1b\[[0-9;]*m//g' "$OUT/container.log" | grep -oE '(Connected peers|Peers): [0-9]+' | grep -oE '[0-9]+$' | sort -n | tail -1)
[ -n "$log_peers" ] && [ "$log_peers" -gt "$max_peers" ] && max_peers=$log_peers
if [ "$max_peers" -ge "$MIN_PEERS" ]; then check PASS peers "up to $max_peers peers (need $MIN_PEERS)"; else check FAIL peers "at most $max_peers peers (need $MIN_PEERS)"; fi

spawned=$(grep -c "spawned: 'teku'" "$OUT/container.log" || true)
exited=$(grep -E "exited: teku |gave up: teku" "$OUT/container.log" | grep -v 'exit status 143' || true)
if [ "$spawned" = 1 ] && [ -z "$exited" ]; then
  check PASS process "supervisord started Teku once and it kept running"
else
  check FAIL process "Teku was started $spawned time(s); $(echo "$exited" | head -2 | tr '\n' ' ')"
fi
FATAL='Unknown option|Invalid value for option|Missing required|OutOfMemoryError|Exception in thread "main"|Teku failed to start|Unable to start|FATAL|Fatal error|Error: Could not find or load main class|Address already in use'
if grep -Eq "$FATAL" "$OUT/container.log"; then
  check FAIL fatal-lines "$(grep -E "$FATAL" "$OUT/container.log" | head -3 | cut -c1-200 | tr '\n' ' ')"
else
  check PASS fatal-lines "no fatal line in the log"
fi
# UDP ports Teku listens on (state 07 in /proc/net/udp*, not loopback) against
# the container ports the manifest publishes as udp.
listen_udp=""
while read -r _ local _ st _; do
  [ "$st" = 07 ] || continue
  case "${local%:*}" in 0100007F | 00000000000000000000000001000000 | 0000000000000000FFFF00000100007F) continue ;; esac
  listen_udp="$listen_udp $((16#${local##*:}))"
done < <(grep -E '^[[:space:]]*[0-9]+:' "$OUT/udp.txt" 2>/dev/null)
listen_udp=$(echo $listen_udp | tr ' ' '\n' | sort -un | tr '\n' ' ' | sed 's/ $//')
published_udp=$(jq -r '.image.ports[] | select(endswith("/udp")) | split(":") | last | sub("/udp$"; "")' "$RENDER/dappnode_package.json" | sort -un | tr '\n' ' ' | sed 's/ $//')
unpublished=""
for p in $listen_udp; do
  echo " $published_udp " | grep -q " $p " || unpublished="$unpublished $p"
done
if [ -z "$listen_udp" ]; then
  check FAIL udp-ports "Teku listens on no UDP port (discovery must listen); see udp.txt"
elif [ -z "$unpublished" ]; then
  check PASS udp-ports "Teku listens on UDP $listen_udp; the manifest publishes $published_udp"
else
  check FAIL udp-ports "Teku listens on UDP$unpublished, which the manifest does not publish (it publishes: ${published_udp:-none}); peers cannot reach it. QUIC? Turn it off or give it a published port (README)"
fi
errors=$(grep -cE '\| ERROR|ERROR  *\|' "$OUT/container.log" || true)
check INFO error-lines "$errors ERROR line(s) in the log (see container.log)"
check INFO cmdline "$(head -1 "$OUT/cmdline.txt" | sed -E 's/.* tech\.pegasys\.teku\.Teku //' | cut -c1-300)"
check INFO monitor "/network answered ${monitor_network:-nothing}"
check INFO stop "stopped within 60 s: $stopped_clean"

if [ "$fails" = 0 ]; then
  echo "PASS: $NETWORK booted on its real network and followed the chain"
else
  echo "FAIL: $fails boot check(s) failed for $NETWORK (logs: $OUT/container.log)" >&2
  echo "----- last 40 log lines" >&2
  tail -40 "$OUT/container.log" >&2
  [ "$outside_only" = 1 ] && exit 2
  exit 1
fi
