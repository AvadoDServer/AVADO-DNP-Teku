#!/bin/bash

NETWORK=gnosis

for file in \
    build/docker-compose.yml \
    dappnode_package.json \
    ./build/wizard/src/components/defaultsettings.json \
    build/avatar.png \
    build/wizard/src/assets/teku.png \
    build/wizard/src/components/network.ts
do
    BASENAME=${file%.*}
    EXT=${file##*.}
    # echo $BASENAME
    # echo $EXT
    rm $file
    ln ${BASENAME}-${NETWORK}.${EXT} $file
done