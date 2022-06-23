ARG TEKU_VERSION
FROM node:16.15.0 as builder

# build wizard
WORKDIR /usr/src/app/wizard
COPY wizard .
RUN yarn
RUN rm -Rf build && yarn run build

# https://github.com/ConsenSys/teku/blob/master/docker/jdk17/Dockerfile
FROM --platform=linux/amd64 consensys/teku:${TEKU_VERSION}

USER root
RUN apt-get -y update && apt-get -y upgrade && apt-get -y install \
    curl \
    gettext\
    jq \
    nginx \
    sudo \
    supervisor \
    vim-tiny \
    && rm -rf /var/lib/apt/lists/*
RUN useradd -s /bin/false nginx

RUN mkdir /data  && chown teku /data
VOLUME /data

COPY --from=builder /usr/src/app/wizard/build /usr/local/wizard

COPY startTeku.sh /opt/teku
COPY teku-config.template /opt/teku
COPY wizard/src/components/defaultsettings.json /opt/teku
RUN chmod a+x /opt/teku/startTeku.sh
COPY supervisord.conf /etc/supervisord.conf
COPY nginx.conf /etc/nginx/

# keystore for ssl access to key store api
EXPOSE 5052
USER teku
RUN curl "http://iso.ava.do/my.ava.do.crt" --output /opt/teku/my.ava.do.crt --silent
RUN curl "http://iso.ava.do/my.ava.do.key" --output /opt/teku/my.ava.do.key --silent
# RUN $JAVA_HOME/bin/keytool -trustcacerts -keystore  "/opt/teku/avado.keyStore" -storepass avadoKeyStorePassword -importcert -alias myAvaDoCrt -file "/opt/teku/my.ava.do.crt" -noprompt
# RUN $JAVA_HOME/bin/keytool -trustcacerts -keystore  "/opt/teku/avado.keyStore" -storepass avadoKeyStorePassword -importcert -alias myAvaDoCrt -file "/opt/teku/my.ava.do.key" -noprompt
RUN openssl pkcs12 -export -in /opt/teku/my.ava.do.crt -inkey /opt/teku/my.ava.do.key -out my.ava.do.p12 -name myavado -CAfile myavado.crt -caname root -password  pass:avadoKeyStorePassword
RUN keytool -importkeystore -deststorepass avadoKeyStorePassword -destkeystore /opt/teku/avado.keystore  -srckeystore /opt/teku/my.ava.do.p12 -srcstoretype PKCS12 -srcstorepass avadoKeyStorePassword -alias myavado

RUN echo "avadoKeyStorePassword" > /opt/teku/keystorePasswordFile

USER root
WORKDIR /
ENTRYPOINT ["supervisord", "--nodaemon", "--configuration", "/etc/supervisord.conf"]


