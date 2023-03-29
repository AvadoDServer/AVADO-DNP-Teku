#!/bin/bash

NETWORK=$1

case ${NETWORK} in
  "gnosis"|"prater"|"mainnet")
    ;;
  *)
    echo "Invalid network"
    exit
    ;;
esac

for file in \
    build/docker-compose.yml \
    dappnode_package.json \
    build/monitor/settings/defaultsettings.json \
    build/avatar.png \
    build/wizard/src/assets/teku.png
do
    BASENAME=${file%.*}
    EXT=${file##*.}
    # echo $BASENAME
    # echo $EXT
    rm -f $file
    ln ${BASENAME}-${NETWORK}.${EXT} $file
done