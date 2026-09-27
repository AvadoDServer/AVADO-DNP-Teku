ARG TEKU_VERSION
ARG TEKU_DIGEST
# node 18.15.0, pinned by its Docker Hub digest
FROM node:18.15.0@sha256:354047346f641fbf9efadac145dd3f328d1ae164680c6a73ffd2a523d605d95f as builder

# NETWORK (mainnet, gnosis) is set by package_variants/<network>/docker-compose.yml.
# The wizard and monitor config and the default settings are generated for it
# here (build/ui-config.sh), so the same sources build every network.
ARG NETWORK
COPY ui-config.sh /usr/src/ui-config.sh
COPY wizard /usr/src/app/wizard
COPY monitor /usr/src/monitor
RUN sh /usr/src/ui-config.sh "${NETWORK}" /usr/src/app/wizard /usr/src/monitor

# build wizard (only what the committed yarn.lock lists)
WORKDIR /usr/src/app/wizard
RUN yarn install --frozen-lockfile
RUN rm -Rf build && yarn run build


# build monitor (only what the committed yarn.lock lists)
WORKDIR /usr/src/monitor
RUN yarn install --frozen-lockfile
RUN rm -Rf build && yarn run build

# https://github.com/ConsenSys/teku/blob/master/docker/jdk17/Dockerfile
# TEKU_VERSION and TEKU_DIGEST come from docker-compose.yml: the tag names the
# version, the digest fixes the exact image.
FROM --platform=linux/amd64 consensys/teku:${TEKU_VERSION}@${TEKU_DIGEST}

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
ENV NVM_DIR /root/.nvm
ENV NODE_VERSION v18.15.0

# nvm v0.39.1's install script, fetched by commit and checked by its sha256
RUN curl -fsSL -o /tmp/nvm-install.sh https://raw.githubusercontent.com/nvm-sh/nvm/9600617c52d0d2e48493424c529ac6c945d2775b/install.sh \
    && echo "fabc489b39a5e9c999c7cab4d281cdbbcbad10ec2f8b9a7f7144ad701b6bfdc7  /tmp/nvm-install.sh" | sha256sum -c - \
    && bash /tmp/nvm-install.sh && rm /tmp/nvm-install.sh \
    && . $NVM_DIR/nvm.sh \
    && nvm install $NODE_VERSION \
    && nvm alias default $NODE_VERSION \
    && nvm use default

ENV NODE_PATH $NVM_DIR/$NODE_VERSION/lib/node_modules
ENV PATH      $NVM_DIR/$NODE_VERSION/bin:$PATH

RUN mkdir /data  && chown teku /data
VOLUME /data

COPY --from=builder /usr/src/app/wizard/build /usr/local/wizard
COPY --from=builder /usr/src/monitor/ /usr/local/monitor

COPY startTeku.sh /opt/teku
COPY reload-certs.sh /opt/teku/reload-certs.sh
COPY teku-config.template /opt/teku
COPY teku-config-syncing-beacon.template /opt/teku
COPY teku-config-syncing-validator.template /opt/teku
COPY --from=builder /usr/src/monitor/settings/defaultsettings.json /opt/teku/defaultsettings.json
RUN chmod a+x /opt/teku/startTeku.sh /opt/teku/reload-certs.sh
COPY supervisord.conf /etc/supervisord.conf
COPY nginx.conf /etc/nginx/

# keystore for ssl access to key store api
EXPOSE 5052
USER teku
RUN curl "http://iso.ava.do/my.ava.do.crt" --output /opt/teku/my.ava.do.crt --silent
RUN curl "http://iso.ava.do/my.ava.do.key" --output /opt/teku/my.ava.do.key --silent
RUN openssl pkcs12 -export -in /opt/teku/my.ava.do.crt -inkey /opt/teku/my.ava.do.key -out /opt/teku/my.ava.do.p12 -name myavado -CAfile myavado.crt -caname root -password  pass:avadoKeyStorePassword
RUN keytool -importkeystore -deststorepass avadoKeyStorePassword -destkeystore /opt/teku/avado.keystore  -srckeystore /opt/teku/my.ava.do.p12 -srcstoretype PKCS12 -srcstorepass avadoKeyStorePassword -alias myavado

RUN echo "avadoKeyStorePassword" > /opt/teku/keystorePasswordFile

USER root
WORKDIR /
ENTRYPOINT ["supervisord", "--nodaemon", "--configuration", "/etc/supervisord.conf"]


