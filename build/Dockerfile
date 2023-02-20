ARG NIMBUS_VERSION
FROM node:16.15.0 as builder

# build wizard
WORKDIR /usr/src/app/wizard
COPY wizard .
RUN yarn
RUN rm -Rf build && yarn run build

# build monitor
WORKDIR /usr/src/monitor
COPY monitor .
RUN rm -Rf build && yarn run build

FROM --platform=linux/amd64 statusim/nimbus-eth2:amd64-${NIMBUS_VERSION}

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

RUN mkdir /data  && chown user /data
VOLUME /data

COPY --from=builder /usr/src/app/wizard/build /usr/local/wizard
COPY --from=builder /usr/src/monitor/build /usr/local/monitor

COPY startNimbus.sh /opt/nimbus/
COPY reload-certs.sh /opt/nimbus/reload-certs.sh
COPY wizard/src/components/defaultsettings.json /opt/nimbus
RUN chmod a+x /opt/nimbus/startNimbus.sh /opt/nimbus/reload-certs.sh
COPY supervisord.conf /etc/supervisord.conf
COPY nginx.conf /etc/nginx/

# EXPOSE 5052
# USER user
# RUN curl "http://iso.ava.do/my.ava.do.crt" --output /opt/nimbus/my.ava.do.crt --silent
# RUN curl "http://iso.ava.do/my.ava.do.key" --output /opt/nimbus/my.ava.do.key --silent

USER root
WORKDIR /
ENTRYPOINT ["supervisord", "--nodaemon", "--configuration", "/etc/supervisord.conf"]


