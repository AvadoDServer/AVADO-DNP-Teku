#!/bin/sh
while true; do
    date > /tmp/reload-certs.txt

    echo "Check for updated certificates"

    md5sumbefore=$(md5sum "/opt/teku/my.ava.do.crt")
    curl "http://iso.ava.do/my.ava.do.crt" --output /opt/teku/my.ava.do.crt --silent
    curl "http://iso.ava.do/my.ava.do.key" --output /opt/teku/my.ava.do.key --silent
    md5sumafter=$(md5sum "/opt/teku/my.ava.do.crt")

    if [ "$md5sumbefore" != "$md5sumafter" ]; then
        openssl pkcs12 -export -in /opt/teku/my.ava.do.crt -inkey /opt/teku/my.ava.do.key -out /opt/teku/my.ava.do.p12 -name myavado -CAfile myavado.crt -caname root -password  pass:avadoKeyStorePassword
        keytool -delete -deststorepass avadoKeyStorePassword -destkeystore /opt/teku/avado.keystore -alias myavado
        keytool -importkeystore -deststorepass avadoKeyStorePassword -destkeystore /opt/teku/avado.keystore  -srckeystore /opt/teku/my.ava.do.p12 -srcstoretype PKCS12 -srcstorepass avadoKeyStorePassword -alias myavado
        supervisorctl restart teku
    fi

    #sleep one day
    sleep 86400
done
