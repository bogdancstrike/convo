#!/bin/sh
# Renders the nginx site for this environment (no addresses are baked into the image):
#   CONVO_TLS=on  (default, Compose): TLS on 443 with the self-signed development certificate.
#   CONVO_TLS=off (Kubernetes): plain HTTP on CONVO_HTTP_LISTEN behind an ingress that terminates
#                 TLS; the original scheme is taken from the ingress' X-Forwarded-Proto.
#   CONVO_KEYCLOAK_ADMIN=off hides Keycloak's admin console and master realm (public deployments).
#   CONVO_KEYCLOAK_ACCOUNT=off hides Keycloak's account console (Convo manages passkeys itself).
# Upstreams default to the Compose service names; Kubernetes sets fully qualified cluster names
# (nginx's resolver does not apply resolv.conf search domains).
set -eu
mkdir -p /etc/nginx/convo
: "${UPSTREAM_SERVER:=server:8080}" "${UPSTREAM_KEYCLOAK:=keycloak:8080}" "${UPSTREAM_LIVEKIT:=livekit:7880}" "${UPSTREAM_S3:=seaweedfs:8333}"
export UPSTREAM_SERVER UPSTREAM_KEYCLOAK UPSTREAM_LIVEKIT UPSTREAM_S3
if [ "${CONVO_TLS:-on}" = "off" ]; then
  cat > /etc/nginx/convo/listen.conf <<CONF
listen ${CONVO_HTTP_LISTEN:-8080};
set \$convo_proto \$http_x_forwarded_proto;
CONF
else
  cat > /etc/nginx/convo/listen.conf <<'CONF'
listen 443 ssl;
ssl_certificate /etc/nginx/tls/server.crt;
ssl_certificate_key /etc/nginx/tls/server.key;
ssl_protocols TLSv1.2 TLSv1.3;
error_page 497 =200 /https-required.html;
set $convo_proto $scheme;
CONF
fi
if [ "${CONVO_KEYCLOAK_ADMIN:-on}" = "off" ]; then
  cat > /etc/nginx/convo/keycloak-admin.conf <<'CONF'
location ^~ /auth/admin/ { return 404; }
location ^~ /auth/realms/master/ { return 404; }
CONF
else
  : > /etc/nginx/convo/keycloak-admin.conf
fi
# CONVO_KEYCLOAK_ACCOUNT=off hides Keycloak's account console: Convo manages passkeys through
# Keycloak actions with its own sign-in theme, and the console shows sessions, apps and profile.
if [ "${CONVO_KEYCLOAK_ACCOUNT:-on}" = "off" ]; then
  echo 'location ~ ^/auth/realms/[^/]+/account(/|$) { return 404; }' >> /etc/nginx/convo/keycloak-admin.conf
fi
# Re-resolve upstream names through the container's own DNS server (Docker or cluster DNS).
dns=$(awk '/^nameserver/ { print $2; exit }' /etc/resolv.conf)
case "$dns" in *:*) dns="[$dns]" ;; esac
echo "resolver ${dns:-127.0.0.11} valid=10s ipv6=off;" > /etc/nginx/convo/resolver.conf
envsubst '${UPSTREAM_SERVER} ${UPSTREAM_KEYCLOAK} ${UPSTREAM_LIVEKIT} ${UPSTREAM_S3}' \
  < /etc/nginx/convo/default.conf.template > /etc/nginx/conf.d/default.conf
