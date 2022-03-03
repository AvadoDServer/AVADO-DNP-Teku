FROM node:16.14.0 as builder

# build wizard
WORKDIR /usr/src/app/wizard
COPY wizard .
RUN yarn
RUN rm -Rf build && yarn run build

# https://github.com/ConsenSys/teku/blob/master/docker/jdk17/Dockerfile
ARG TEKU_VERSION
# FROM consensys/teku:${TEKU_VERSION}
FROM consensys/teku:22.3.0

USER root
RUN apt-get -y update && apt-get -y upgrade && apt-get -y install curl supervisor nginx sudo
RUN rm -rf /var/lib/api/lists/*ß
RUN useradd -s /bin/false nginx

COPY --from=builder /usr/src/app/wizard/build /usr/local/wizard

COPY supervisord.conf /etc/supervisord.conf
COPY nginx.conf /etc/nginx/

# TODO?
# RUN useradd nginx

WORKDIR /
ENTRYPOINT ["supervisord", "--nodaemon", "--configuration", "/etc/supervisord.conf"]


