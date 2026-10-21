# Convo admin console: build with Node, serve with nginx on its own origin.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.29-alpine
RUN apk add --no-cache openssl && rm -f /etc/nginx/conf.d/default.conf
COPY nginx/15-self-signed-tls.sh /docker-entrypoint.d/15-self-signed-tls.sh
COPY nginx/20-admin-config.sh /docker-entrypoint.d/20-admin-config.sh
COPY nginx/default.conf.template /etc/nginx/convo/default.conf.template
COPY nginx/headers.conf /etc/nginx/convo/headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 443 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD if [ "$CONVO_TLS" = off ]; then wget -q -O /dev/null http://127.0.0.1:${CONVO_HTTP_LISTEN:-8080}/; else wget --no-check-certificate -q -O /dev/null https://127.0.0.1/; fi || exit 1
