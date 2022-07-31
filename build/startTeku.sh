#!/bin/bash

SETTINGSFILE=$1
TARGETCONFIGFILE=$2

if [ ! -f "${SETTINGSFILE}" ]; then
    echo "Starting with default settings"
    cp /opt/teku/defaultsettings.json ${SETTINGSFILE}
fi

NETWORK=$(cat ${SETTINGSFILE} | jq '."network"' | tr -d '"')
JWT_TOKEN_PATH=$(cat ${SETTINGSFILE} | jq '."jwttokenpath"' | tr -d '"')
curl ${JWT_TOKEN_PATH} --silent --output "/data/data-${NETWORK}/jwttoken"

# Create config file
GRAFFITI=$(cat ${SETTINGSFILE} | jq '."validators_graffiti"' | tr -d '"') \
EE_ENDPOINT=$(cat ${SETTINGSFILE} | jq '."ee_endpoint"' | tr -d '"') \
ETH1_ENDPOINTS=$(cat ${SETTINGSFILE} | jq '."eth1_endpoints"' | tr -d '"') \
VALIDATORS_PROPOSER_DEFAULT_FEE_RECIPIENT=$(cat ${SETTINGSFILE} | jq '."validators_proposer_default_fee_recipient" // empty' | tr -d '"') \
P2P_PEER_LOWER_BOUND=$(cat ${SETTINGSFILE} | jq '."p2p_peer_lower_bound"' | tr -d '"') \
P2P_PEER_UPPER_BOUND=$(cat ${SETTINGSFILE} | jq '."p2p_peer_upper_bound"' | tr -d '"') \
INITIAL_STATE=$(cat ${SETTINGSFILE} | jq '."initial_state"' | tr -d '"') \
DATA_PATH="/data/data-${NETWORK}" \
NETWORK="${NETWORK}" \
    envsubst < $(dirname "$0")/teku-config.template > $TARGETCONFIGFILE

# Start teku
VALIDATORS_PROPOSER_DEFAULT_FEE_RECIPIENT=$(cat ${SETTINGSFILE} | jq '."validators_proposer_default_fee_recipient" // empty'| tr -d '"')
BUILDER_ENDPOINT=$(cat ${SETTINGSFILE} | jq '."builder_endpoint"  // empty' | tr -d '"')
MEV_BOOST_ENABLED=$(cat ${SETTINGSFILE} | jq '."mev_boost"  // empty' | tr -d '"')
exec /opt/teku/bin/teku \
  --ee-jwt-secret-file="/data/data-${NETWORK}/jwttoken" \
  --config-file="$TARGETCONFIGFILE" \
  ${VALIDATORS_PROPOSER_DEFAULT_FEE_RECIPIENT:+--validators-proposer-default-fee-recipient=${VALIDATORS_PROPOSER_DEFAULT_FEE_RECIPIENT}} \
  ${BUILDER_ENDPOINT:+--builder-endpoint=${BUILDER_ENDPOINT}} \
  ${MEV_BOOST_ENABLED:+validators-builder-registration-default-enabled=${MEV_BOOST_ENABLED}} \
  ${EXTRA_OPTS}
