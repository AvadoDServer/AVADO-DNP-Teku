#!/bin/bash

SETTINGSFILE=$1

# wait for settingsfile to exist (initial start only)
if [ ! -f "${SETTINGSFILE}" ]; then
    echo "Waiting for creation of ${SETTINGSFILE}"
fi
while [ ! -f "${SETTINGSFILE}" ]; do sleep 1; done


# Create config file
NETWORK=$(cat ${SETTINGSFILE} | jq '."network"' | tr -d '"')
NETWORK="prater"
WEB3_URL=$(cat ${SETTINGSFILE} | jq '."web_url"' | tr -d '"')
DATA_DIR="/data/data-${NETWORK}"

API_TOKEN_FILE="/data/KEY-API-TOKEN"
# create random token
if [ ! -f "${API_TOKEN_FILE}" ]; then
  echo $RANDOM | sha256sum | head -c 20 > ${API_TOKEN_FILE}
fi

# Start Nimbus
/home/user/nimbus-eth2/build/nimbus_beacon_node \
  --non-interactive \
  --network="${NETWORK}" \
  --data-dir="${DATA_DIR}" \
  --web3-url="wss://goerli.infura.io/ws/v3/f4f7ba9611404db09f74e6da099f8053" \
  --rest \
  --rest-port="5555" \
  --rest-address="0.0.0.0" \
  --metrics:off \
  --keymanager \
  --keymanager-port="5555" \
  --keymanager-address="0.0.0.0" \
  --keymanager-token-file="${API_TOKEN_FILE}"

  # --keymanager-allow-origin="localhost" \
  # --rest-allow-origin="http://localhost:3000" \
  # --rest-allow-origin="http://nimbus.my.ava.do" \

# topics="beacnde" version=v22.4.0-039bec-stateofus bls_backend=BLST cmdParams="@[\"--non-interactive\", \"--network=prater\", \"--data-dir=/data/data-prater\", \"--web3-url=wss://goerli.infura.io/ws/v3/f4f7ba9611404db09f74e6da099f8053\", \"--rest\", \"--rest-port=5555\"]" config="(configFile: None[InputFile], logLevel: \"INFO\", logStdout: auto, logFile: None[OutFile], eth2Network: Some(\"prater\"), dataDir: /data/data-prater, validatorsDirFlag: None[InputDir], secretsDirFlag: None[InputDir], walletsDirFlag: None[InputDir], web3Urls: @[\"wss://goerli.infura.io/ws/v3/f4f7ba9611404db09f74e6da099f8053\"], web3ForcePolling: false, nonInteractive: true, netKeyFile: \"random\", netKeyInsecurePassword: false, agentString: \"nimbus\", subscribeAllSubnets: false, slashingDbKind: v2, numThreads: 0, cmd: noCommand, runAsServiceFlag: false, bootstrapNodes: @[], bootstrapNodesFile: , listenAddress: 0.0.0.0, tcpPort: 9000, udpPort: 9000, maxPeers: 160, hardMaxPeers: None[int], nat: (hasExtIp: false, nat: NatAny), enrAutoUpdate: false, weakSubjectivityCheckpoint: None[Checkpoint], finalizedCheckpointState: None[InputFile], finalizedCheckpointBlock: None[InputFile], nodeName: \"\", graffiti: None[GraffitiBytes], verifyFinalization: false, stopAtEpoch: 0, stopAtSyncedEpoch: 0, metricsEnabled: false, metricsAddress: 127.0.0.1, metricsPort: 8008, statusBarEnabled: true, statusBarContents: \"peers: $connected_peers;finalized: $finalized_root:$finalized_epoch;head: $head_root:$head_epoch:$head_epoch_slot;time: $epoch:$epoch_slot ($slot);sync: $sync_status|ETH: $attached_validators_balance\", rpcEnabled: false, rpcPort: 9190, rpcAddress: 127.0.0.1, restEnabled: true, restPort: 5555, restAddress: 127.0.0.1, restAllowedOrigin: None[TaintedString], restCacheSize: 3, restCacheTtl: 60, restRequestTimeout: 0, restMaxRequestBodySize: 16384, restMaxRequestHeadersSize: 64, keymanagerEnabled: false, keymanagerPort: 5052, keymanagerAddress: 127.0.0.1, keymanagerAllowedOrigin: None[TaintedString], keymanagerTokenFile: None[InputFile], serveLightClientData: None[bool], importLightClientData: None[ImportLightClientData], inProcessValidators: true, discv5Enabled: true, dumpEnabled: false, directPeers: @[], doppelgangerDetection: true, syncHorizon: 50, terminalTotalDifficultyOverride: None[TaintedString], validatorMonitorAuto: false, validatorMonitorPubkeys: @[], validatorMonitorTotals: false, proposerBoosting: false, useJwt: false, safeSlotsToImportOptimistically: 128, jwtSecret: None[TaintedString])"