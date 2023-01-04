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
    DISCOVERY_BOOTNODES="enr:-Ly4QClooKhmB409-xLE52rTmC2h9kZBO_VFXR-kjqLDdduuZoxsjfwTxa1jscQMBpqmezG_JCwPpEzEYRM_1UCy-0gCh2F0dG5ldHOIAAAAAAAAAACEZXRoMpCCS-QxAgAAZP__________gmlkgnY0gmlwhKXoiruJc2VjcDI1NmsxoQLLYztVAaOL2dhsQf884Vth9ro6n9p2yj-osPfZ0L_NwYhzeW5jbmV0cwCDdGNwgiMog3VkcIIjKA,enr:-Ly4QHO5_3Zuosjt9IJQF3ovGroSWyB4rMZFUulOl5R5PkjcfVwtYewEp2TvUpo9tvHYMGKpDxgAYmjjTJcGasqn9uoCh2F0dG5ldHOIAAAAAAAAAACEZXRoMpCCS-QxAgAAZP__________gmlkgnY0gmlwhI_GnBiJc2VjcDI1NmsxoQJqvGdusfukoXNx3F84umajVgkfVs0wasHeY45qcYgwf4hzeW5jbmV0cwCDdGNwgiMog3VkcIIjKA,enr:-Ly4QPd8v1jzDOHuEAEJ-NPgbLgRRbsuuz4KZOSZ2YiIaD0dQ-BMbbzEw0Cix5wst0suFVrsrB73dg0_980zpbKKzzEBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpCCS-QxAgAAZP__________gmlkgnY0gmlwhJ_f1T2Jc2VjcDI1NmsxoQNdZWlOxiBbJltPxilQgdllvE_cNF6sC1bpyRUyWegVjohzeW5jbmV0cwCDdGNwgiMog3VkcIIjKA,enr:-Ly4QAOrFTIBlS__dwh0hhMLcGB-mbRTgMJc1P4MfMyd15-dX75_TBq7RsqWMLsZzdidoU41zO0fvI8-w7N8dHrpA54Bh2F0dG5ldHOIAAAAAAAAAACEZXRoMpCCS-QxAgAAZP__________gmlkgnY0gmlwhLI-woiJc2VjcDI1NmsxoQKeJ-BUNBGaVYX1MgnAsvjgJpGXVKgEMZa1_FMG8fTYl4hzeW5jbmV0cwCDdGNwgiMog3VkcIIjKA,enr:-Ly4QM0mWWtb978oZpY46_DVEY9SOkyDKprDlu6NyI6cjRX0TDYGp9txkyREyRw3mIkXWFDsdhONUZqKzjD09lp3iLIBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpCCS-QxAgAAZP__________gmlkgnY0gmlwhLI-wMOJc2VjcDI1NmsxoQNXBYeo4Oa9Hksc247JWokwgpZAJzZxWMMK1KG3UYl4w4hzeW5jbmV0cwCDdGNwgiMog3VkcIIjKA,enr:-Ly4QDnJWKfiGm6U6SyLr8r-BfM6zHlI90VPsgbxiXb6GhIUVcDmeGw_IRxLpUAelnu2sH8TtF9uenfIGdAshoUZHAUBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpCCS-QxAgAAZP__________gmlkgnY0gmlwhKdj0Q6Jc2VjcDI1NmsxoQIrmmOVYy87sV-n8x8QxfCKLsf_eKqwk6Rl5Gj-YLV8wYhzeW5jbmV0cwCDdGNwgiMog3VkcIIjKA,enr:-L24QJHzedzjOM6Xm53qSdrbP635LvqpxFCJy_2T84rZvVVjV81kS_kRKp7vV_PFPS2EHdSzpXtDMJCugvzdhjRZeGkGh2F0dG5ldHOIAAAAAAAAAACEZXRoMpCCS-QxAgAAZP__________gmlkgnY0gmlwhIm45FOJc2VjcDI1NmsxoQPHxbRx1Ev72MVVUergKeLznxrchLhB3lK9ljWCbCuGWYhzeW5jbmV0c4gAAAAAAAAAAIN0Y3CCIyg,enr:-L24QK00qalnMGv7PVg5k9Z7OjPFhIFoHLm6SDP8DjKOgFO5aUHzCqecoA9S3Y_0nI8mOF8sF1mYqYEE7byacE1Vq6YGh2F0dG5ldHOIAAAAAAAAAACEZXRoMpCCS-QxAgAAZP__________gmlkgnY0gmlwhKRcYG-Jc2VjcDI1NmsxoQPUtWI-6bkId_18Hy0KCautFQ5GJD-f2cgYCqNS5EekRIhzeW5jbmV0c4gAAAAAAAAAAIN0Y3CCIyg,enr:-L24QPdWmlPHi-0fQKptAjtkhKG50novgUHWeP5amyi_lGSWcQPAahWl7Ci3kW2p1Sd6WRtqlgkxSyvc6wioeaQl9ZIGh2F0dG5ldHOIAAAAAAAAAACEZXRoMpCCS-QxAgAAZP__________gmlkgnY0gmlwhLI-xGiJc2VjcDI1NmsxoQLNCuDR6ik6JcTW8uAsoPn6AMgtNvGq65kCnJmA2HY2JIhzeW5jbmV0c4gAAAAAAAAAAIN0Y3CCIyg,enr:-L24QICiK4pSRAOgkO7R3yQVbjJXGVt1vbdvXsom0yA-UqlMIHO98f8tZyEKbz0lrgrdy89Vw_agSKzuGS7Hgi3QsygGh2F0dG5ldHOIAAAAAAAAAACEZXRoMpCCS-QxAgAAZP__________gmlkgnY0gmlwhJ_f1aaJc2VjcDI1NmsxoQKyGQswAJ5pJaPF9WRpGU4Lp8CdxiSlm8AHJsr1naz_7YhzeW5jbmV0c4gAAAAAAAAAAIN0Y3CCIyg,enr:-KG4QKWOgedErRLsanl1AUjTFnHB-RO9OsyFP-vtSrX2VGxRBdvoJVrzBJwgGYLIBiDjqy0eYJ2r8ZosAjkWhQ02koUGhGV0aDKQgkvkMQIAAGT__________4JpZIJ2NIJpcISf39WdiXNlY3AyNTZrMaEDYAuZlJpKwWdGtbSrVgy6N5sdMjehVglGMGGkBCFg_VeDdGNwgiMog3VkcIIjKA,enr:-KG4QBart9YQV5Ju3EMxUUnJ0ntgYf7J6jDbEPySiR7R8gJ9DcTp22gArHqWSMQVyt0-TMnuZrZQCprcaka5J8B9JN8GhGV0aDKQgkvkMQIAAGT__________4JpZIJ2NIJpcISf39G5iXNlY3AyNTZrMaED13MHlUcbr4978YYNRurZtykey8gTY_O5pQ4a427ZICuDdGNwgiMog3VkcIIjKA,enr:-KG4QLk-EkZCAjhMaBSlB4r6Icrz137hIx6WXg5AKIXQl9vkPt876WxIhzu8dVPCLVfaPzjAsIjXeBUPy2E3VH4QEuEGhGV0aDKQgkvkMQIAAGT__________4JpZIJ2NIJpcISf39n5iXNlY3AyNTZrMaECtocMlfvwxqouGi13SSdG6Tkn3shkyBQt1BIpF0fhXc-DdGNwgiMog3VkcIIjKA,enr:-KG4QDXI2zubDpp7QowlafGwwTLu4w-gFztFYNnA6_I0vrpaS9bXQydY_Gh8Dc6c7cy9SHEi56HRfle9jkKIbSRQ2B8GhGV0aDKQgkvkMQIAAGT__________4JpZIJ2NIJpcISf39WiiXNlY3AyNTZrMaECZ2_0tLZ9kb0Wn-lVNcZEyhVG9dmXX_xzQXQq24sdbZiDdGNwgiMog3VkcIIjKA,enr:-LK4QPnudCfJYvcmV-LjJBU5jexY3QTdC1PepWK08OHb4w_BJ3OgFbh0Bc2nb1WRK6p2CBNOPAixpPrtAvmNQPgegDgBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpBW_bXgAQAAZP__________gmlkgnY0gmlwhJO2zMWJc2VjcDI1NmsxoQKk8-B9o94CY2UUK2bxPpl-T_yHmTtE7rAPaT26M4w09YN0Y3CCIyiDdWRwgiMo,enr:-LK4QArhQjC_S3CwptV7balWpNP5IVKweAqZzvq93vz_zN_ZSruOxBU5ECgqOBUFHO1nYUveOYVeiEKswg637rOURDABh2F0dG5ldHOIAAAAAAAAAACEZXRoMpBW_bXgAQAAZP__________gmlkgnY0gmlwhIm4t0GJc2VjcDI1NmsxoQIj9iJm4h7OAhhCoUcqfn41_fj9F7UfKnISj_-xqKH834N0Y3CCIyiDdWRwgiMo,enr:-Ly4QMU1y81COwm1VZgxGF4_eZ21ub9-GHF6dXZ29aEJ0oZpcV2Rysw-viaEKfpcpu9ZarILJLxFZjcKOjE0Sybs3MQBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpCCS-QxAgAAZP__________gmlkgnY0gmlwhANLnx-Jc2VjcDI1NmsxoQKoaYT8I-wf2I_f_ii6EgoSSXj5T3bhiDyW-7ZLsY3T64hzeW5jbmV0cwCDdGNwgiMog3VkcIIjKA,enr:-Ly4QJcPfzPTwhknVlYmCMYo1vtOqItLLV9iiydSuMYoCcJ6G38V6JiJaRNQUTR-1sivBsJIESP9A4KhoO_k9vOR9ZoBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpCCS-QxAgAAZP__________gmlkgnY0gmlwhBLGgjaJc2VjcDI1NmsxoQPKKRjNBuhorFa1FbCJ8xgkbhu5Jm-uYyafBiLIN-mIiYhzeW5jbmV0cwCDdGNwgiMog3VkcIIjKA,enr:-Ly4QLjZUWdqUO_RwyDqCAccIK5-MbLRD6A2c7oBuVbBgBnWDkEf0UKJVAaJqi2pO101WVQQLYSnYgz1Q3pRhYdrlFoBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpCCS-QxAgAAZP__________gmlkgnY0gmlwhANA8sSJc2VjcDI1NmsxoQK4TC_EK1jSs0VVPUpOjIo1rhJmff2SLBPFOWSXMwdLVYhzeW5jbmV0cwCDdGNwgiMog3VkcIIjKA"
    ;;
  "prater")
    P2P_PORT=9003
    ;;
  *)
    P2P_PORT=9000
    ;;
esac

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
  --ee-jwt-secret-file="/data/data-${NETWORK}/jwttoken" \
  --config-file="$TARGETCONFIGFILE" \
  ${VALIDATORS_PROPOSER_DEFAULT_FEE_RECIPIENT:+--validators-proposer-default-fee-recipient=${VALIDATORS_PROPOSER_DEFAULT_FEE_RECIPIENT}} \
  ${MEV_BOOST_ENABLED:+--builder-endpoint="http://mevboost.my.ava.do:18550"} \
  ${MEV_BOOST_ENABLED:+--validators-builder-registration-default-enabled=${MEV_BOOST_ENABLED}} \
  ${DISCOVERY_BOOTNODES:+--p2p-discovery-bootnodes=${DISCOVERY_BOOTNODES}} \
  ${EXTRA_OPTS}
