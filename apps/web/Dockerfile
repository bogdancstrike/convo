# Enclave web client: build with Node, serve with nginx (also the same-origin reverse proxy).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# COVERAGE=1: Istanbul-instrumented build for e2e coverage runs (docker-compose.coverage.yaml).
ARG COVERAGE=0
RUN VITE_COVERAGE=$COVERAGE npm run build

FROM nginx:1.29-alpine
RUN apk add --no-cache openssl
COPY nginx/15-self-signed-tls.sh /docker-entrypoint.d/15-self-signed-tls.sh
COPY nginx/https-required.html.template /etc/nginx/templates/https-required.html.template
ENV NGINX_ENVSUBST_OUTPUT_DIR=/usr/share/nginx/html
COPY nginx/default.conf.template /etc/nginx/convo/default.conf.template
COPY nginx/20-convo-config.sh /docker-entrypoint.d/20-convo-config.sh
RUN rm -f /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80 443 8080
# Direct TLS (Compose) or plain HTTP behind an ingress (CONVO_TLS=off; Kubernetes uses its own probes).
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD if [ "$CONVO_TLS" = off ]; then wget -q -O /dev/null http://127.0.0.1:${CONVO_HTTP_LISTEN:-8080}/v1/deployment-info; else wget --no-check-certificate -q -O /dev/null https://127.0.0.1/v1/deployment-info; fi || exit 1
