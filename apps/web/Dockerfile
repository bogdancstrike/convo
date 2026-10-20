# Enclave web client: build with Node, serve with nginx (also the same-origin reverse proxy).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.29-alpine
RUN apk add --no-cache openssl
COPY nginx/15-self-signed-tls.sh /docker-entrypoint.d/15-self-signed-tls.sh
COPY nginx/https-required.html.template /etc/nginx/templates/https-required.html.template
ENV NGINX_ENVSUBST_OUTPUT_DIR=/usr/share/nginx/html
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80 443
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget --no-check-certificate -q -O /dev/null https://127.0.0.1/v1/deployment-info || exit 1
