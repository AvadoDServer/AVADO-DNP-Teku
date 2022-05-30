#!/bin/bash

SETTINGSFILE=$1
TARGETCONFIGFILE=$2

# wait for settingsfile to exist (initial start only)
if [ ! -f "${SETTINGSFILE}" ]; then
    echo "Waiting for creation of ${SETTINGSFILE}"
fi
while [ ! -f "${SETTINGSFILE}" ]; do sleep 1; done


# Create config file
NETWORK=$(cat ${SETTINGSFILE} | jq '."network"' | tr -d '"') \
GRAFFITI=$(cat ${SETTINGSFILE} | jq '."validators_graffiti"' | tr -d '"') \
EE_ENDPOINT=$(cat ${SETTINGSFILE} | jq '."ee_endpoint"' | tr -d '"') \
ETH1_ENDPOINTS=$(cat ${SETTINGSFILE} | jq '."eth1_endpoints"' | tr -d '"') \
P2P_PEER_LOWER_BOUND=$(cat ${SETTINGSFILE} | jq '."p2p_peer_lower_bound"' | tr -d '"') \
P2P_PEER_UPPER_BOUND=$(cat ${SETTINGSFILE} | jq '."p2p_peer_upper_bound"' | tr -d '"') \
INITIAL_STATE=$(cat ${SETTINGSFILE} | jq '."initial_state"' | tr -d '"') \
DATA_PATH="/data/data-${NETWORK}" \
    envsubst < $(dirname "$0")/teku-config.template > $TARGETCONFIGFILE

# Start teku
echo "***** Launching Teku version $(/opt/teku/bin/teku --version) *****"
/opt/teku/bin/teku --config-file="$TARGETCONFIGFILE" ${EXTRA_OPTS}
