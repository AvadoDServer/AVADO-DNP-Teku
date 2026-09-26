#!/bin/sh
# Writes the per-network files the wizard and the monitor are compiled with:
#   wizard/src/server_config.json          {"network": "<network>", "name": "teku"}
#   monitor/server_config.json             the same
#   monitor/settings/defaultsettings.json  a copy of settings/defaultsettings-<network>.json
#
# The Dockerfile runs it with the NETWORK build arg, which comes from
# package_variants/<network>/docker-compose.yml. These files are generated,
# never committed, so main is never switched between networks.
#
# Local UI development: build/ui-config.sh mainnet
#
# usage: ui-config.sh <network> [wizard-dir] [monitor-dir]
set -eu

NETWORK=${1:-}
HERE=$(cd "$(dirname "$0")" && pwd)
WIZARD=${2:-$HERE/wizard}
MONITOR=${3:-$HERE/monitor}

case "$NETWORK" in
"" | *[!a-z0-9-]*)
  echo "ui-config.sh: NETWORK must be a network name such as mainnet or gnosis (got '$NETWORK')" >&2
  exit 1
  ;;
esac

DEFAULTS="$MONITOR/settings/defaultsettings-$NETWORK.json"
if [ ! -f "$DEFAULTS" ]; then
  echo "ui-config.sh: no default settings for network '$NETWORK' ($DEFAULTS)" >&2
  exit 1
fi
if ! grep -q "^ *\"network\": \"$NETWORK\"," "$DEFAULTS"; then
  echo "ui-config.sh: $DEFAULTS does not name network '$NETWORK'" >&2
  exit 1
fi

printf '{\n  "network": "%s",\n  "name": "teku"\n}\n' "$NETWORK" >"$WIZARD/src/server_config.json"
cp "$WIZARD/src/server_config.json" "$MONITOR/server_config.json"
cp "$DEFAULTS" "$MONITOR/settings/defaultsettings.json"
echo "ui-config.sh: UI config written for network $NETWORK"
