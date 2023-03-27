ARG TEKU_VERSION
FROM node:18.15.0 as builder

# build wizard
WORKDIR /usr/src/app/wizard
COPY wizard .
RUN yarn
RUN rm -Rf build && yarn run build


# build monitor
WORKDIR /usr/src/monitor
COPY monitor .
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
    nodejs \
    procps \
    sudo \
    supervisor \
    vim-tiny \
    && rm -rf /var/lib/apt/lists/*
RUN useradd -s /bin/false nginx

# Instal node v18.15.0
RUN curl https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash \
    && . /root/.nvm/nvm.sh \
    && nvm install v18.15.0 \
    && nvm use v18.15.0

RUN mkdir /data  && chown teku /data
VOLUME /data

COPY --from=builder /usr/src/app/wizard/build /usr/local/wizard
COPY --from=builder /usr/src/monitor/ /usr/local/monitor

COPY startTeku.sh /opt/teku
COPY reload-certs.sh /opt/teku/reload-certs.sh
COPY teku-config.template /opt/teku
COPY monitor/settings/defaultsettings.json /opt/teku
RUN chmod a+x /opt/teku/startTeku.sh /opt/teku/reload-certs.sh
COPY supervisord.conf /etc/supervisord.conf
COPY nginx.conf /etc/nginx/

# keystore for ssl access to key store api
EXPOSE 5052
USER teku
RUN curl "https://iso.ava.do/my.ava.do.crt" --output /opt/teku/my.ava.do.crt --silent
RUN curl "https://iso.ava.do/my.ava.do.key" --output /opt/teku/my.ava.do.key --silent
RUN openssl pkcs12 -export -in /opt/teku/my.ava.do.crt -inkey /opt/teku/my.ava.do.key -out /opt/teku/my.ava.do.p12 -name myavado -CAfile myavado.crt -caname root -password  pass:avadoKeyStorePassword
RUN keytool -importkeystore -deststorepass avadoKeyStorePassword -destkeystore /opt/teku/avado.keystore  -srckeystore /opt/teku/my.ava.do.p12 -srcstoretype PKCS12 -srcstorepass avadoKeyStorePassword -alias myavado

RUN echo "avadoKeyStorePassword" > /opt/teku/keystorePasswordFile

USER root
WORKDIR /
ENTRYPOINT ["supervisord", "--nodaemon", "--configuration", "/etc/supervisord.conf"]


