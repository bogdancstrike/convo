#!/usr/bin/env bash
# Generates a VAPID (Web Push) P-256 key pair as base64url, ready for .env or a Kubernetes secret:
#   CONVO_VAPID_PUBLIC_KEY  -> enclave.push.web-push.public-key (public, given to browsers)
#   CONVO_VAPID_PRIVATE_KEY -> enclave.push.web-push.private-key (secret; never commit it)
# Keep the pair stable: changing it invalidates every browser's subscription (they re-subscribe).
set -euo pipefail
pem=$(mktemp); trap 'rm -f "$pem"' EXIT
openssl ecparam -name prime256v1 -genkey -noout -out "$pem" 2>/dev/null
b64url() { base64 -w0 | tr '+/' '-_' | tr -d '='; }
# SEC1 DER: 30 77 02 01 01 04 20 <32-byte private scalar> ...
private=$(openssl ec -in "$pem" -outform DER 2>/dev/null | tail -c +8 | head -c 32 | b64url)
# SubjectPublicKeyInfo DER ends with the 65-byte uncompressed point.
public=$(openssl ec -in "$pem" -pubout -outform DER 2>/dev/null | tail -c 65 | b64url)
printf 'CONVO_VAPID_PUBLIC_KEY=%s\nCONVO_VAPID_PRIVATE_KEY=%s\n' "$public" "$private"
