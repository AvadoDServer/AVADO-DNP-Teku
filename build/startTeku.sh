#!/bin/bash

SETTINGSFILE=$1
TARGETCONFIGFILE=$2

# wait for settingsfile to exist (initial start only)
if [ ! -f "${SETTINGSFILE}" ]
then
    echo "Waiting for creation of ${SETTINGSFILE}"
fi
while [ ! -f "${SETTINGSFILE}" ]; do sleep 1; done

NETWORK=$(cat ${SETTINGSFILE}| jq '."network"' | tr -d '"')
GRAFFITI=$(cat ${SETTINGSFILE}| jq '."validators_graffiti"' | tr -d '"')
ETH1_ENDPOINTS=$(cat ${SETTINGSFILE}| jq '."eth1_endpoints"' | tr -d '"')
P2P_PEER_LOWER_BOUND=$(cat ${SETTINGSFILE}| jq '."p2p_peer_lower_bound"' | tr -d '"')
P2P_PEER_UPPER_BOUND=$(cat ${SETTINGSFILE}| jq '."p2p_peer_upper_bound"' | tr -d '"')

DATA_PATH="/data/data-${NETWORK}"

CONFIG_JSON=$(cat <<EOF
# Generated file.
# Do not change this file, manual changes will be overwritten
# You can overwrite settings via EXTRA_OPTS (advanced)

# network
network: "${NETWORK}"

# p2p
p2p-enabled: true
p2p-port: 9000
p2p-peer-lower-bound: ${P2P_PEER_LOWER_BOUND}
p2p-peer-upper-bound: ${P2P_PEER_UPPER_BOUND}

# validators
validators-graffiti: "${GRAFFITI}"

# Eth 1
eth1-endpoint: ${ETH1_ENDPOINTS}

# metrics
metrics-enabled: false # TODO: beaconchain monitor
metrics-categories: ["BEACON","LIBP2P","NETWORK"]

# database
data-path: "${DATA_PATH}"
data-storage-mode: "prune"

# rest api

rest-api-port: 5051
rest-api-docs-enabled: true
rest-api-enabled: true
rest-api-interface: "0.0.0.0"
rest-api-host-allowlist: "*"
rest-api-cors-origins: "*"

# validator api
# Validator api requires ssl keystore to be defined.

validator-api-cors-origins: "*"
validator-api-docs-enabled: true
validator-api-enabled: true
validator-api-host-allowlist: "*"
validator-api-interface: "0.0.0.0"
validator-api-keystore-file: /opt/teku/avado.keystore
validator-api-keystore-password-file: /opt/teku/keystorePasswordFile
validator-api-port: 5052

# logging
log-include-validator-duties-enabled: true
EOF
)

# must use doublequotes!
# printf "$CONFIG_JSON"

# must use doublequotes here too!
printf "$CONFIG_JSON" > "$TARGETCONFIGFILE"

# Start teku
/opt/teku/bin/teku --config-file="$TARGETCONFIGFILE" ${EXTRA_OPTS}