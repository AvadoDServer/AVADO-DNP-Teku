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
    build/wizard/src/components/defaultsettings.json \
    build/avatar.png \
    build/wizard/src/assets/nimbus.png \
    build/wizard/src/components/network.ts
do
    BASENAME=${file%.*}
    EXT=${file##*.}
    # echo $BASENAME
    # echo $EXT
    rm -f $file
    ln ${BASENAME}-${NETWORK}.${EXT} $file
done