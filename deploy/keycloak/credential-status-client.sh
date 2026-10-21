#!/usr/bin/env bash
# Idempotently provisions the read-only service-account client used by
# GET /v1/account/credentials. Runs inside the Keycloak image (kcadm.sh) as the compose
# `keycloak-setup` one-shot service; safe to re-run against an existing realm and users.
set -euo pipefail
: "${KEYCLOAK_URL:=http://keycloak:8080/auth}"
: "${REALM:=enclave}"
: "${CLIENT_ID:=convo-credential-status}"
kcadm=/opt/keycloak/bin/kcadm.sh
"$kcadm" config credentials --config /tmp/kcadm.config --server "$KEYCLOAK_URL" --realm master \
  --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null
k() { "$kcadm" "$@" --config /tmp/kcadm.config; }
# Passkeys are bound to the deployment hostname (WebAuthn RP ID); keep the realm in step with it.
if [[ -n "${CONVO_HOSTNAME:-}" ]]; then
  k update "realms/$REALM" -s "webAuthnPolicyPasswordlessRpId=$CONVO_HOSTNAME" -s "webAuthnPolicyRpId=$CONVO_HOSTNAME"
  echo "Passkey RP ID set to $CONVO_HOSTNAME"
fi
if [[ -z "${CLIENT_SECRET:-}" ]]; then
  echo "CONVO_CREDENTIAL_STATUS_SECRET is not set; passkey status stays unavailable." >&2
  exit 0
fi
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
# Organization administrators (ADM-01): realm role checked by /v1/admin/**.
if ! k get roles/convo-admin -r "$REALM" >/dev/null 2>&1; then
  k create roles -r "$REALM" -s name=convo-admin -s 'description=Convo organization administrator (admin console)' >/dev/null
  echo "Created realm role convo-admin"
fi
# Scoped admin roles (least privilege, specs §19): helpdesk, organization admin, security, auditor.
for spec in "convo-helpdesk:Convo helpdesk (accounts, devices, revoke a device)" "convo-org-admin:Convo organization admin (accounts, disable/enable)" \
            "convo-security:Convo security operator (accounts, devices, revoke, disable, read audit)" "convo-auditor:Convo auditor (read, verify, export audit)"; do
  role="${spec%%:*}"
  if ! k get "roles/$role" -r "$REALM" >/dev/null 2>&1; then
    k create roles -r "$REALM" -s "name=$role" -s "description=${spec#*:}" >/dev/null && echo "Created realm role $role"
  fi
done
if [[ -n "${ADMIN_USERNAMES:-}" ]]; then
  for user in ${ADMIN_USERNAMES//,/ }; do
    k add-roles -r "$REALM" --uusername "$user" --rolename convo-admin 2>/dev/null && echo "Granted convo-admin to $user" || echo "No user $user (skipped)"
  done
fi
# Passkey set-up from Convo Settings (Keycloak application-initiated action) returns to this page.
web=$(k get clients -r "$REALM" -q clientId=enclave-web --fields id --format csv --noquotes | head -n1)
if [[ -n "$web" ]]; then
  k update "clients/$web" -r "$REALM" -s 'redirectUris=["/convo/callback","/convo/passkey-done","/convo/admin"]'
  echo "enclave-web redirect URIs include /convo/passkey-done"
fi
