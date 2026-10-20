#!/bin/sh
set -eu
dns_name=${CONVO_HOSTNAME:-convo.doncea.ro}
server_ip=${CONVO_SERVER_IP:-192.168.1.144}
if [ ! -s /etc/nginx/tls/server.key ]; then
  umask 077
  mkdir -p /etc/nginx/tls
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out /etc/nginx/tls/server.key
fi
if [ ! -s /etc/nginx/tls/server.crt ] || ! openssl x509 -in /etc/nginx/tls/server.crt -noout -checkhost "$dns_name" >/dev/null 2>&1 || ! openssl x509 -in /etc/nginx/tls/server.crt -noout -checkip "$server_ip" >/dev/null 2>&1; then
  umask 077
  openssl req -x509 -key /etc/nginx/tls/server.key -sha256 -days 3650 \
    -out /etc/nginx/tls/server.crt -subj '/CN=Convo development' \
    -addext "subjectAltName=DNS:localhost,DNS:$dns_name,IP:127.0.0.1,IP:::1,IP:$server_ip"
fi
