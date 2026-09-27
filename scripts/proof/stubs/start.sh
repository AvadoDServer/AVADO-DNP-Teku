#!/bin/bash
# Runs the image's start script the way supervisord does (program "teku",
# user teku), after placing the profile's settings file when it has one.
set -e
if [ -f /seed/settings.json ]; then
  cp /seed/settings.json /data/settings.json
fi
exec /bin/sh -c "/opt/teku/startTeku.sh /data/settings.json /data/config.yml"
