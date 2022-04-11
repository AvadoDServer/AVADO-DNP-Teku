#!/bin/bash

SETTINGSFILE=$1

# wait for settingsfile to exist (initial start only)
if [ ! -f "${SETTINGSFILE}" ]; then
    echo "Waiting for creation of ${SETTINGSFILE}"
fi
while [ ! -f "${SETTINGSFILE}" ]; do sleep 1; done


# Create config file
NETWORK=$(cat ${SETTINGSFILE} | jq '."network"' | tr -d '"')
WEB3_URL=$(cat ${SETTINGSFILE} | jq '."web_url"' | tr -d '"')
DATA_DIR="/data/data-${NETWORK}"

# create random token
echo $RANDOM | sha256sum | head -c 20 > /data/KEY-API-TOKEN

# Start Nimbus
/home/user/nimbus-eth2/build/nimbus_beacon_node \
  --non-interactive \
  --network="${NETWORK}" \
  --data-dir="${DATA_DIR}" \
  --web3-url="https://mainnet.infura.io/v3/f4f7ba9611404db09f74e6da099f8053" \
  --rest \
  --rest-allow-origin="*" \
  --rest-api-interface="0.0.0.0" \
  --metrics:off \
  --keymanager \
  --keymanager-token-file="/data/KEY-API-TOKEN"
