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
  until $(curl --silent --fail "http://dappmanager.my.ava.do/jwttoken.txt" --output "${JWT_SECRET}"); do
    echo "Waiting for the JWT Token"
    sleep 5
  done

  case ${NETWORK} in
    "gnosis")
      P2P_PORT=9006
      ;;
    "prater")
      P2P_PORT=9003
      ;;
    *)
      P2P_PORT=9000
      ;;
  esac


  # Clean up stale locks if they exist
  if compgen -G "/data/data-${NETWORK}/validator/key-manager/local/*.json.lock" > /dev/null; then
      echo "Found validator locks at startup."
      rm /data/data-${NETWORK}/validator/key-manager/local/*.json.lock
  fi

if [ "$MODE" = "syncing" ]; then

  echo "Starting Teku in dual process mode"


  # Create config file
  GRAFFITI=$(cat ${SETTINGSFILE} | jq -r '."validators_graffiti"') \
  EE_ENDPOINT=$(cat ${SETTINGSFILE} | jq -r '."ee_endpoint"') \
  P2P_PEER_LOWER_BOUND=$(cat ${SETTINGSFILE} | jq -r '."p2p_peer_lower_bound"') \
  P2P_PEER_UPPER_BOUND=$(cat ${SETTINGSFILE} | jq -r '."p2p_peer_upper_bound"') \
  INITIAL_STATE=$(cat ${SETTINGSFILE} | jq -r '."initial_state"') \
  DATA_PATH="/data/data-${NETWORK}" \
  P2P_PORT=${P2P_PORT} \
  NETWORK="${NETWORK}" \
      envsubst < $(dirname "$0")/teku-config-syncing-beacon.template > /data/syncing-beaconchain.yml

echo "--- /data/syncing-beaconchain.yml ---"
cat /data/syncing-beaconchain.yml
echo "---"

  # Create config file
  GRAFFITI=$(cat ${SETTINGSFILE} | jq -r '."validators_graffiti"') \
  EE_ENDPOINT=$(cat ${SETTINGSFILE} | jq -r '."ee_endpoint"') \
  P2P_PEER_LOWER_BOUND=$(cat ${SETTINGSFILE} | jq -r '."p2p_peer_lower_bound"') \
  P2P_PEER_UPPER_BOUND=$(cat ${SETTINGSFILE} | jq -r '."p2p_peer_upper_bound"') \
  INITIAL_STATE=$(cat ${SETTINGSFILE} | jq -r '."initial_state"') \
  DATA_PATH="/data/data-${NETWORK}" \
  P2P_PORT=${P2P_PORT} \
  NETWORK="${NETWORK}" \
      envsubst < $(dirname "$0")/teku-config-syncing-validator.template > /data/syncing-validator.yml



echo "--- /data/syncing-validator.yml ---"
cat /data/syncing-validator.yml
echo "---"


  # Start teku Beacon chain
  VALIDATORS_PROPOSER_DEFAULT_FEE_RECIPIENT=$(cat ${SETTINGSFILE} | jq -r '."validators_proposer_default_fee_recipient" // empty')
  MEV_BOOST_ENABLED=$(cat ${SETTINGSFILE} | jq -r '."mev_boost" // empty')
  
  echo "*** Starting beacon node"

  exec /opt/teku/bin/teku \
    --ee-jwt-secret-file="${JWT_SECRET}" \
    --config-file="/data/syncing-beaconchain.yml" \
    ${DISCOVERY_BOOTNODES:+--p2p-discovery-bootnodes=${DISCOVERY_BOOTNODES}} &
  
  sleep 5

  echo "*** Starting validator"

  exec /opt/teku/bin/teku validator-client \
    --beacon-node-api-endpoint="https://wearesyncing.ava.do" \
    --config-file="/data/syncing-validator.yml"  

else

  echo "Starting Teku in single process mode"

  # Create config file
  GRAFFITI=$(cat ${SETTINGSFILE} | jq -r '."validators_graffiti"') \
  EE_ENDPOINT=$(cat ${SETTINGSFILE} | jq -r '."ee_endpoint"') \
  P2P_PEER_LOWER_BOUND=$(cat ${SETTINGSFILE} | jq -r '."p2p_peer_lower_bound"') \
  P2P_PEER_UPPER_BOUND=$(cat ${SETTINGSFILE} | jq -r '."p2p_peer_upper_bound"') \
  INITIAL_STATE=$(cat ${SETTINGSFILE} | jq -r '."initial_state"') \
  DATA_PATH="/data/data-${NETWORK}" \
  P2P_PORT=${P2P_PORT} \
  NETWORK="${NETWORK}" \
      envsubst < $(dirname "$0")/teku-config.template > $TARGETCONFIGFILE


  # Start teku
  VALIDATORS_PROPOSER_DEFAULT_FEE_RECIPIENT=$(cat ${SETTINGSFILE} | jq -r '."validators_proposer_default_fee_recipient" // empty')
  MEV_BOOST_ENABLED=$(cat ${SETTINGSFILE} | jq -r '."mev_boost" // empty')
  exec /opt/teku/bin/teku \
    --ee-jwt-secret-file="${JWT_SECRET}" \
    --config-file="$TARGETCONFIGFILE" \
    ${VALIDATORS_PROPOSER_DEFAULT_FEE_RECIPIENT:+--validators-proposer-default-fee-recipient=${VALIDATORS_PROPOSER_DEFAULT_FEE_RECIPIENT}} \
    ${MEV_BOOST_ENABLED:+--builder-endpoint="http://mevboost.my.ava.do:18550"} \
    ${MEV_BOOST_ENABLED:+--validators-builder-registration-default-enabled=${MEV_BOOST_ENABLED}} \
    ${DISCOVERY_BOOTNODES:+--p2p-discovery-bootnodes=${DISCOVERY_BOOTNODES}} \
    ${EXTRA_OPTS}

fi