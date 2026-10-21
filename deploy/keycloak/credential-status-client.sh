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
# Required actions Convo relies on (passkey registration from Settings, profile/phone, OTP,
# password changes). A realm import registers only the actions its JSON lists, so make sure each
# one exists and is enabled, also on realms imported before the list was complete.
for action in UPDATE_PROFILE UPDATE_PASSWORD CONFIGURE_TOTP webauthn-register webauthn-register-passwordless \
              VERIFY_PROFILE delete_credential CONFIGURE_RECOVERY_AUTHN_CODES update_user_locale; do
  if ! k get "authentication/required-actions/$action" -r "$REALM" >/dev/null 2>&1; then
    # The Keycloak image has no awk/sed: match the CSV row in bash.
    name=$(k get authentication/unregistered-required-actions -r "$REALM" --format csv --noquotes --fields providerId,name \
      | while IFS=, read -r id label; do [[ "$id" == "$action" ]] && echo "$label"; done)
    if [[ -n "$name" ]]; then
      k create authentication/register-required-action -r "$REALM" -s "providerId=$action" -s "name=$name" >/dev/null && echo "Registered required action $action"
    fi
  fi
  k update "authentication/required-actions/$action" -r "$REALM" -s enabled=true >/dev/null 2>&1 || echo "Required action $action unavailable" >&2
done
if [[ -z "${CLIENT_SECRET:-}" ]]; then
  echo "CONVO_CREDENTIAL_STATUS_SECRET is not set; passkey status stays unavailable." >&2
else
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
fi
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
  k update "clients/$web" -r "$REALM" -s 'redirectUris=["/convo/callback","/convo/passkey-done"]'
  echo "enclave-web redirect URIs: /convo/callback, /convo/passkey-done"
fi
# Admin console (separate origin, e.g. convo-admin.doncik.ro): public PKCE client whose only
# redirect is the console's callback, resolved on whichever origin proxies /auth.
admin_client=$(k get clients -r "$REALM" -q clientId=convo-admin --fields id --format csv --noquotes | head -n1)
admin_settings=(-s enabled=true -s publicClient=true -s standardFlowEnabled=true -s directAccessGrantsEnabled=false -s implicitFlowEnabled=false
  -s serviceAccountsEnabled=false -s 'rootUrl=${authBaseUrl}' -s 'redirectUris=["/convo/admin"]' -s 'webOrigins=["+"]'
  -s 'attributes."pkce.code.challenge.method"=S256' -s 'attributes."post.logout.redirect.uris"=/*' -s 'description=Convo admin console')
if [[ -z "$admin_client" ]]; then
  k create clients -r "$REALM" -s clientId=convo-admin "${admin_settings[@]}" >/dev/null && echo "Created convo-admin"
else
  k update "clients/$admin_client" -r "$REALM" "${admin_settings[@]}" && echo "Updated convo-admin"
fi
# Sign-in account management for the admin API: confidential service account limited to users.
if [[ -n "${ADMIN_OPS_SECRET:-}" ]]; then
  ops=$(k get clients -r "$REALM" -q clientId=convo-admin-ops --fields id --format csv --noquotes | head -n1)
  ops_settings=(-s enabled=true -s publicClient=false -s serviceAccountsEnabled=true -s standardFlowEnabled=false
    -s directAccessGrantsEnabled=false -s implicitFlowEnabled=false -s clientAuthenticatorType=client-secret
    -s "secret=$ADMIN_OPS_SECRET" -s 'description=Convo server: sign-in account management for the admin console')
  if [[ -z "$ops" ]]; then
    k create clients -r "$REALM" -s clientId=convo-admin-ops "${ops_settings[@]}" >/dev/null && echo "Created convo-admin-ops"
  else
    k update "clients/$ops" -r "$REALM" "${ops_settings[@]}" && echo "Updated convo-admin-ops"
  fi
  for role in manage-users view-users view-realm; do
    k add-roles -r "$REALM" --uusername service-account-convo-admin-ops --cclientid realm-management --rolename "$role"
  done
  echo "Granted realm-management/manage-users, view-users, view-realm to convo-admin-ops"
else
  echo "CONVO_ADMIN_OPS_SECRET is not set; sign-in account management stays unavailable." >&2
fi
