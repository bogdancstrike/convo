#!/usr/bin/env bash
# Idempotently provisions the read-only service-account client used by
# GET /v1/account/credentials. Runs inside the Keycloak image (kcadm.sh) as the compose
# `keycloak-setup` one-shot service; safe to re-run against an existing realm and users.
set -euo pipefail
: "${KEYCLOAK_URL:=http://keycloak:8080/auth}"
: "${REALM:=enclave}"
: "${CLIENT_ID:=convo-credential-status}"
kcadm=/opt/keycloak/bin/kcadm.sh
if [[ -z "${CLIENT_SECRET:-}" ]]; then
  echo "CONVO_CREDENTIAL_STATUS_SECRET is not set; passkey status stays unavailable." >&2
  exit 0
fi
"$kcadm" config credentials --config /tmp/kcadm.config --server "$KEYCLOAK_URL" --realm master \
  --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null
k() { "$kcadm" "$@" --config /tmp/kcadm.config; }
id=$(k get clients -r "$REALM" -q clientId="$CLIENT_ID" --fields id --format csv --noquotes | head -n1)
settings=(-s enabled=true -s publicClient=false -s serviceAccountsEnabled=true -s standardFlowEnabled=false
  -s directAccessGrantsEnabled=false -s implicitFlowEnabled=false -s clientAuthenticatorType=client-secret
  -s "secret=$CLIENT_SECRET" -s 'description=Convo server: read-only credential types for app-lock gating')
if [[ -z "$id" ]]; then
  k create clients -r "$REALM" -s "clientId=$CLIENT_ID" "${settings[@]}" >/dev/null
  echo "Created $CLIENT_ID"
else
  k update "clients/$id" -r "$REALM" "${settings[@]}"
  echo "Updated $CLIENT_ID"
fi
# Least privilege: view-users only (no manage-users / realm-admin).
k add-roles -r "$REALM" --uusername "service-account-$CLIENT_ID" --cclientid realm-management --rolename view-users
echo "Granted realm-management/view-users"
