#!/bin/sh
set -eu
# Behind an ingress (CONVO_TLS=off) the ingress owns TLS: no certificate is needed here.
[ "${CONVO_TLS:-on}" = "off" ] && exit 0
dns_name=${CONVO_HOSTNAME:-localhost}
server_ip=${CONVO_SERVER_IP:-}
if [ ! -s /etc/nginx/tls/server.key ]; then
  umask 077
  mkdir -p /etc/nginx/tls
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out /etc/nginx/tls/server.key
fi
if [ ! -s /etc/nginx/tls/server.crt ] || ! openssl x509 -in /etc/nginx/tls/server.crt -noout -checkhost "$dns_name" >/dev/null 2>&1 \
   || { [ -n "$server_ip" ] && ! openssl x509 -in /etc/nginx/tls/server.crt -noout -checkip "$server_ip" >/dev/null 2>&1; }; then
  umask 077
  openssl req -x509 -key /etc/nginx/tls/server.key -sha256 -days 3650 \
    -out /etc/nginx/tls/server.crt -subj '/CN=Convo development' \
    -addext "subjectAltName=DNS:localhost,DNS:$dns_name,IP:127.0.0.1,IP:::1${server_ip:+,IP:$server_ip}"
fi
