#!/bin/sh
set -eu
if [ ! -s /etc/nginx/tls/server.crt ] || [ ! -s /etc/nginx/tls/server.key ]; then
  umask 077
  mkdir -p /etc/nginx/tls
  openssl req -x509 -nodes -newkey rsa:3072 -sha256 -days 3650 \
    -keyout /etc/nginx/tls/server.key -out /etc/nginx/tls/server.crt \
    -subj '/CN=Convo development' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1'
fi
