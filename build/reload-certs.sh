#!/bin/sh
while true; do
    date > /tmp/reload-certs.txt

    echo "Check for updated certificates"

    md5sumbefore=$(md5sum "/opt/nimbus/my.ava.do.crt")
    curl "http://dappmanager.my.ava.do/my.ava.do.crt" --output /opt/nimbus/my.ava.do.crt --silent
    curl "http://dappmanager.my.ava.do/my.ava.do.key" --output /opt/nimbus/my.ava.do.key --silent
    md5sumafter=$(md5sum "/opt/nimbus/my.ava.do.crt")

    # if [ "$md5sumbefore" != "$md5sumafter" ]; then
    #     openssl pkcs12 -export -in /opt/nimbus/my.ava.do.crt -inkey /opt/nimbus/my.ava.do.key -out /opt/nimbus/my.ava.do.p12 -name myavado -CAfile myavado.crt -caname root -password  pass:avadoKeyStorePassword
    #     keytool -delete -deststorepass avadoKeyStorePassword -destkeystore /opt/nimbus/avado.keystore -alias myavado
    #     keytool -importkeystore -deststorepass avadoKeyStorePassword -destkeystore /opt/nimbus/avado.keystore  -srckeystore /opt/nimbus/my.ava.do.p12 -srcstoretype PKCS12 -srcstorepass avadoKeyStorePassword -alias myavado
    #     supervisorctl restart nimbus
    # fi

    #sleep one day
    sleep 86400
done
