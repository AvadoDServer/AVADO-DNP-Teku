#!/bin/bash

SETTINGSFILE=$1

# wait for settingsfile to exist (initial start only)
if [ ! -f "${SETTINGSFILE}" ]; then
    echo "Waiting for creation of ${SETTINGSFILE}"
fi
while [ ! -f "${SETTINGSFILE}" ]; do sleep 1; done

NETWORK=$(cat ${SETTINGSFILE} | jq '."network"' | tr -d '"')
NETWORK="prater"
WEB3_URL=$(cat ${SETTINGSFILE} | jq '."web_url"' | tr -d '"')
DATA_DIR="/data/data-${NETWORK}"

echo "not starting"