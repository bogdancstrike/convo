#!/usr/bin/env sh
# Creates the self-signed TLS certificate for LiveKit on the VPS (valid 10 years) with the VPS IP and
# the fixed name "convo-rtc" (which convo-web verifies; nginx cannot verify bare IPs).
# Usage: ./gen-certs.sh <public-ip>
set -eu
ip="${1:?usage: $0 <public-ip>}"
mkdir -p certs
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 3650 \
  -subj "/CN=convo-rtc" -addext "subjectAltName=DNS:convo-rtc,IP:${ip}" \
  -keyout certs/rtc.key -out certs/rtc.crt 2>/dev/null
chmod 600 certs/rtc.key
echo "certs/rtc.crt and certs/rtc.key created for ${ip}"
