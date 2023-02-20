#!/bin/bash

SETTINGSFILE=$1

if [ ! -f "${SETTINGSFILE}" ]; then
    echo "Starting with default settings"
    cp /opt/nimbus/defaultsettings.json ${SETTINGSFILE}
fi

NETWORK=$(cat ${SETTINGSFILE} | jq '."network"' | tr -d '"')
mkdir -p "/data/data-${NETWORK}/" && chown user:user "/data/data-${NETWORK}/"

# Get JWT Token
JWT_SECRET="/data/data-${NETWORK}/jwttoken"
until $(curl --silent --fail "http://dappmanager.my.ava.do/jwttoken.txt" --output "${JWT_SECRET}"); do
  echo "Waiting for the JWT Token"
  sleep 5
done

KEYMANAGER_TOKEN="/data/data-${NETWORK}/keymanagertoken"
if [[ ! -e ${KEYMANAGER_TOKEN} ]]; then
    openssl rand -hex 32 > ${KEYMANAGER_TOKEN}
fi

case ${NETWORK} in
  "prater")
    P2P_PORT=9003
    ;;
  *)
    P2P_PORT=9000
    ;;
esac

# Create config file
GRAFFITI=$(cat ${SETTINGSFILE} | jq -r '."validators_graffiti"')
EE_ENDPOINT=$(cat ${SETTINGSFILE} | jq -r '."ee_endpoint"')
P2P_PEER_LOWER_BOUND=$(cat ${SETTINGSFILE} | jq -r '."p2p_peer_lower_bound"')
P2P_PEER_UPPER_BOUND=$(cat ${SETTINGSFILE} | jq -r '."p2p_peer_upper_bound"')
INITIAL_STATE=$(cat ${SETTINGSFILE} | jq -r '."initial_state"')
DATA_PATH="/data/data-${NETWORK}"

# Initial state / checkpoint sync
if [ ! -d "${DATA_PATH}/db" ]; then
  INITIAL_STATE_FILE="/data/data-${NETWORK}/initial_state.ssz"
  if [ ! -f "${INITIAL_STATE_FILE}" ]; then
    case ${NETWORK} in
      "prater")
        until $(curl -sH 'Accept: application/octet-stream' --silent --fail "${INITIAL_STATE}" --output "${INITIAL_STATE_FILE}"); do
          echo "Waiting for initial state download"
          sleep 5
        done
        ;;
      *)
        until $(curl --insecure --silent --fail "${INITIAL_STATE}" --output "${INITIAL_STATE_FILE}"); do
          echo "Waiting for initial state download"
          sleep 5
        done
        ;;
    esac
  fi
fi

# Start Nimbus
VALIDATORS_PROPOSER_DEFAULT_FEE_RECIPIENT=$(cat ${SETTINGSFILE} | jq -r '."validators_proposer_default_fee_recipient" // empty')
MEV_BOOST_ENABLED=$(cat ${SETTINGSFILE} | jq -r '."mev_boost" // empty')
exec /home/user/nimbus-eth2/build/nimbus_beacon_node \
  --non-interactive \
  --jwt-secret="${JWT_SECRET}" \
  --web3-url="${EE_ENDPOINT}" \
  --keymanager \
  ${INITIAL_STATE_FILE:+--finalized-checkpoint-state="${INITIAL_STATE_FILE}"} \
  --keymanager-token-file="${KEYMANAGER_TOKEN}" \
  --tcp-port=${P2P_PORT} \
  --udp-port=${P2P_PORT} \
  --rest \
  --rest-port=5052 \
  --network=${NETWORK} \
  --data-dir="${DATA_PATH}" \
  --hard-max-peers="${P2P_PEER_UPPER_BOUND}" \
  --graffiti="${GRAFFITI}"
  ${VALIDATORS_PROPOSER_DEFAULT_FEE_RECIPIENT:+--suggested-fee-recipient=${VALIDATORS_PROPOSER_DEFAULT_FEE_RECIPIENT}} \
  ${MEV_BOOST_ENABLED:+--payload-builder-url="http://mevboost.my.ava.do:18550"} \
  ${MEV_BOOST_ENABLED:+--payload-builder=${MEV_BOOST_ENABLED}} \
  ${EXTRA_OPTS}
