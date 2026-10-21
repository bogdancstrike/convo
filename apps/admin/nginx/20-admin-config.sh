#!/bin/sh
# Renders the admin console's nginx site (no addresses baked into the image):
#   CONVO_TLS=on  (default, Compose): TLS on 443 with the self-signed development certificate.
#   CONVO_TLS=off (Kubernetes): plain HTTP on CONVO_HTTP_LISTEN behind a TLS-terminating ingress.
# Upstreams default to Compose service names; Kubernetes sets fully qualified cluster names.
set -eu
mkdir -p /etc/nginx/convo
: "${UPSTREAM_SERVER:=server:8080}" "${UPSTREAM_KEYCLOAK:=keycloak:8080}"
export UPSTREAM_SERVER UPSTREAM_KEYCLOAK
if [ "${CONVO_TLS:-on}" = "off" ]; then
  printf 'listen %s;\nset $convo_proto $http_x_forwarded_proto;\n' "${CONVO_HTTP_LISTEN:-8080}" > /etc/nginx/convo/listen.conf
else
  cat > /etc/nginx/convo/listen.conf <<'CONF'
listen 443 ssl;
ssl_certificate /etc/nginx/tls/server.crt;
ssl_certificate_key /etc/nginx/tls/server.key;
ssl_protocols TLSv1.2 TLSv1.3;
set $convo_proto $scheme;
CONF
fi
dns=$(awk '/^nameserver/ { print $2; exit }' /etc/resolv.conf)
case "$dns" in *:*) dns="[$dns]" ;; esac
echo "resolver ${dns:-127.0.0.11} valid=10s ipv6=off;" > /etc/nginx/convo/resolver.conf
envsubst '${UPSTREAM_SERVER} ${UPSTREAM_KEYCLOAK}' < /etc/nginx/convo/default.conf.template > /etc/nginx/conf.d/default.conf
