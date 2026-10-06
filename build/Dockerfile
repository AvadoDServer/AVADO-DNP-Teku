ARG TEKU_VERSION

# Build the shared AVADO Client UI (https://github.com/AvadoDServer/AVADO-Client-UI)
# Exact Node patch tag so a rebuild of this release uses the same toolchain;
# the UI source is pinned by its release tag below.
FROM node:20.20.2-bookworm-slim AS ui
ARG CLIENT_UI_VERSION=v0.1.1
ARG CLIENT_UI_REPO=https://github.com/AvadoDServer/AVADO-Client-UI
RUN apt-get -y update && apt-get -y install --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch ${CLIENT_UI_VERSION} ${CLIENT_UI_REPO} /ui
WORKDIR /ui
RUN yarn install --frozen-lockfile && yarn build

FROM node:18.15.0 as builder


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
ENV NVM_DIR /root/.nvm
ENV NODE_VERSION v18.15.0

RUN curl https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash \
    && . $NVM_DIR/nvm.sh \
    && nvm install $NODE_VERSION \
    && nvm alias default $NODE_VERSION \
    && nvm use default

ENV NODE_PATH $NVM_DIR/$NODE_VERSION/lib/node_modules
ENV PATH      $NVM_DIR/$NODE_VERSION/bin:$PATH

RUN mkdir /data  && chown teku /data
VOLUME /data

COPY --from=ui /ui/dist /usr/local/wizard

# The UI build ships no client-config.json; tell it which client and network it
# serves. The network comes from the monitor's config (set by setNetwork.sh).
COPY monitor/server_config.json /tmp/server_config.json
RUN NETWORK=$(jq -r .network /tmp/server_config.json) \
    && test -n "${NETWORK}" && test "${NETWORK}" != null \
    && if [ "${NETWORK}" = "mainnet" ]; then PREFIX=teku; else PREFIX="teku-${NETWORK}"; fi \
    && jq -n --arg network "${NETWORK}" --arg prefix "${PREFIX}" '{ \
        client: "teku", \
        network: $network, \
        packageName: ($prefix + ".avado.dnp.dappnode.eth"), \
        apiUrl: ("http://" + $prefix + ".my.ava.do:9999"), \
        backend: "monitor", \
        features: { batchImport: true, backup: false, zeroSync: false } \
    }' > /usr/local/wizard/client-config.json \
    && cat /usr/local/wizard/client-config.json \
    && rm /tmp/server_config.json
COPY --from=builder /usr/src/monitor/ /usr/local/monitor

COPY startTeku.sh /opt/teku
COPY reload-certs.sh /opt/teku/reload-certs.sh
COPY teku-config.template /opt/teku
COPY teku-config-syncing-beacon.template /opt/teku
COPY teku-config-syncing-validator.template /opt/teku
COPY monitor/settings/defaultsettings.json /opt/teku
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


