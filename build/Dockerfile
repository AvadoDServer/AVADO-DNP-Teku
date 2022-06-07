ARG NIMBUS_VERSION
FROM node:16.15.0 as builder

# build wizard
WORKDIR /usr/src/app/wizard
COPY wizard .
RUN yarn
RUN rm -Rf build && yarn run build

FROM statusim/nimbus-eth2:amd64-${NIMBUS_VERSION}

USER root
RUN apt-get -y update && apt-get -y upgrade && apt-get -y install curl supervisor nginx sudo jq vim
RUN rm -rf /var/lib/api/lists/*
RUN useradd -s /bin/false nginx

RUN mkdir /data  && chown user /data
VOLUME /data

COPY --from=builder /usr/src/app/wizard/build /usr/local/wizard

COPY startNimbus.sh /home/user/
RUN chmod a+x /home/user/startNimbus.sh
COPY supervisord.conf /etc/supervisord.conf
COPY nginx.conf /etc/nginx/

WORKDIR /
ENTRYPOINT ["supervisord", "--nodaemon", "--configuration", "/etc/supervisord.conf"]


