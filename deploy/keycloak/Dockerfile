# Convo identity provider for production (Kubernetes): Keycloak with the Convo login theme, the
# realm (without development users) and the idempotent setup script baked in. Compose keeps using
# the upstream image with these files mounted.
FROM alpine:3.22 AS realm
RUN apk add --no-cache jq
COPY enclave-realm.json /realm/enclave-realm.json
RUN jq 'del(.users)' /realm/enclave-realm.json > /realm/enclave-realm.prod.json

FROM quay.io/keycloak/keycloak:26.4 AS build
ENV KC_DB=postgres KC_HTTP_RELATIVE_PATH=/auth KC_HEALTH_ENABLED=true
RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:26.4
COPY --from=build /opt/keycloak/ /opt/keycloak/
COPY themes/convo /opt/keycloak/themes/convo
COPY --from=realm /realm/enclave-realm.prod.json /opt/keycloak/data/import/enclave-realm.json
COPY credential-status-client.sh /opt/convo/setup.sh
# Imports the realm on first start only; later starts keep the database's realm.
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--optimized", "--import-realm"]
