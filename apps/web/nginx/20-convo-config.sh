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
# LiveKit signalling: `host:port` (plain HTTP, in-cluster/Compose) or a full `https://host` URL for a
# LiveKit on another machine (e.g. a public VPS that carries the media); TLS upstreams get SNI and
# their own Host header.
case "$UPSTREAM_LIVEKIT" in
  https://*) LIVEKIT_URL="${UPSTREAM_LIVEKIT%/}"; LIVEKIT_HOST="${LIVEKIT_URL#https://}"; LIVEKIT_HOST="${LIVEKIT_HOST%%/*}" ;;
  http://*) LIVEKIT_URL="${UPSTREAM_LIVEKIT%/}"; LIVEKIT_HOST='$http_host' ;;
  *) LIVEKIT_URL="http://$UPSTREAM_LIVEKIT"; LIVEKIT_HOST='$http_host' ;;
esac
# A LiveKit reached by IP (no public certificate): UPSTREAM_LIVEKIT_CERT pins its self-signed
# certificate (PEM; the only one trusted for it) and UPSTREAM_LIVEKIT_TLS_NAME is the DNS name inside
# that certificate that nginx verifies (nginx cannot verify IP addresses).
LIVEKIT_CA_FILE=/etc/ssl/certs/ca-certificates.crt
LIVEKIT_TLS_NAME="${UPSTREAM_LIVEKIT_TLS_NAME:-${LIVEKIT_HOST%%:*}}"
case "$LIVEKIT_TLS_NAME" in '$'*) LIVEKIT_TLS_NAME='$proxy_host' ;; esac
if [ -n "${UPSTREAM_LIVEKIT_CERT:-}" ]; then
  printf '%s\n' "$UPSTREAM_LIVEKIT_CERT" > /etc/nginx/convo/livekit.crt
  LIVEKIT_CA_FILE=/etc/nginx/convo/livekit.crt
fi
export UPSTREAM_SERVER UPSTREAM_KEYCLOAK UPSTREAM_LIVEKIT UPSTREAM_S3 LIVEKIT_URL LIVEKIT_HOST LIVEKIT_CA_FILE LIVEKIT_TLS_NAME
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
# Android App Links (call links open the app without a chooser): CONVO_ANDROID_CERT_SHA256 lists the
# signing-certificate SHA-256 fingerprints (comma-separated, AA:BB:… form) of the Convo APKs to trust
# for CONVO_ANDROID_PACKAGE. Unset: no assetlinks.json is served (links still open via a chooser).
if [ -n "${CONVO_ANDROID_CERT_SHA256:-}" ]; then
  mkdir -p /usr/share/nginx/html/.well-known
  prints=$(printf '%s' "$CONVO_ANDROID_CERT_SHA256" | tr -d ' ' | tr 'a-f' 'A-F' | awk -F, '{ for (i = 1; i <= NF; i++) if ($i != "") printf "%s\"%s\"", (n++ ? "," : ""), $i }')
  printf '[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"android_app","package_name":"%s","sha256_cert_fingerprints":[%s]}}]\n' \
    "${CONVO_ANDROID_PACKAGE:-com.convo.android}" "$prints" > /usr/share/nginx/html/.well-known/assetlinks.json
fi
# Re-resolve upstream names through the container's own DNS server (Docker or cluster DNS).
dns=$(awk '/^nameserver/ { print $2; exit }' /etc/resolv.conf)
case "$dns" in *:*) dns="[$dns]" ;; esac
echo "resolver ${dns:-127.0.0.11} valid=10s ipv6=off;" > /etc/nginx/convo/resolver.conf
envsubst '${UPSTREAM_SERVER} ${UPSTREAM_KEYCLOAK} ${UPSTREAM_LIVEKIT} ${UPSTREAM_S3} ${LIVEKIT_URL} ${LIVEKIT_HOST} ${LIVEKIT_CA_FILE} ${LIVEKIT_TLS_NAME}' \
  < /etc/nginx/convo/default.conf.template > /etc/nginx/conf.d/default.conf
