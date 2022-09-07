#!/bin/bash

SETTINGSFILE=$1
TARGETCONFIGFILE=$2

if [ ! -f "${SETTINGSFILE}" ]; then
    echo "Starting with default settings"
    cp /opt/teku/defaultsettings.json ${SETTINGSFILE}
fi

NETWORK=$(cat ${SETTINGSFILE} | jq '."network"' | tr -d '"')
mkdir -p "/data/data-${NETWORK}/" && chown teku:teku "/data/data-${NETWORK}/"

# Get JWT Token
JWT_SECRET="/data/data-${NETWORK}/jwttoken"
JWT_TOKEN_PATH=$(cat ${SETTINGSFILE} | jq -r 'if has("jwttokenpath") then ."jwttokenpath" else "https://ethchain-geth.my.ava.do/jwttoken" end')
until $(curl --silent --fail ${JWT_TOKEN_PATH} --output "${JWT_SECRET}"); do
  echo "Waiting for Geth package to generate the JWT Token"
  sleep 5
done

# Create config file
GRAFFITI=$(cat ${SETTINGSFILE} | jq -r '."validators_graffiti"') \
EE_ENDPOINT=$(cat ${SETTINGSFILE} | jq -r '."ee_endpoint"') \
ETH1_ENDPOINTS=$(cat ${SETTINGSFILE} | jq -r '."eth1_endpoints"') \
P2P_PEER_LOWER_BOUND=$(cat ${SETTINGSFILE} | jq -r '."p2p_peer_lower_bound"') \
P2P_PEER_UPPER_BOUND=$(cat ${SETTINGSFILE} | jq -r '."p2p_peer_upper_bound"') \
INITIAL_STATE=$(cat ${SETTINGSFILE} | jq -r '."initial_state"') \
DATA_PATH="/data/data-${NETWORK}" \
NETWORK="${NETWORK}" \
    envsubst < $(dirname "$0")/teku-config.template > $TARGETCONFIGFILE

# Start teku
VALIDATORS_PROPOSER_DEFAULT_FEE_RECIPIENT=$(cat ${SETTINGSFILE} | jq -r '."validators_proposer_default_fee_recipient" // empty')
BUILDER_ENDPOINT=$(cat ${SETTINGSFILE} | jq -r '."builder_endpoint" // empty')
MEV_BOOST_ENABLED=$(cat ${SETTINGSFILE} | jq -r '."mev_boost" // empty')
exec /opt/teku/bin/teku \
  --ee-jwt-secret-file="/data/data-${NETWORK}/jwttoken" \
  --config-file="$TARGETCONFIGFILE" \
  ${VALIDATORS_PROPOSER_DEFAULT_FEE_RECIPIENT:+--validators-proposer-default-fee-recipient=${VALIDATORS_PROPOSER_DEFAULT_FEE_RECIPIENT}} \
  ${BUILDER_ENDPOINT:+--builder-endpoint=${BUILDER_ENDPOINT}} \
  ${MEV_BOOST_ENABLED:+--validators-builder-registration-default-enabled=${MEV_BOOST_ENABLED}} \
  ${EXTRA_OPTS}
