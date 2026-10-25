# Convo archive/bot runtime. Build from the repository root so the core bundle can be copied:
#   docker build -f deploy/convo-bot/Dockerfile -t convo-bot .
FROM mcr.microsoft.com/playwright:v1.56.1-noble
WORKDIR /app
RUN npm init -y >/dev/null && npm install --no-audit --no-fund playwright@1.56.1
COPY deploy/convo-bot/bot.mjs ./
COPY deploy/convo-bot/examples ./examples
COPY apps/android/app/src/main/assets/core.js ./core.js
ENV DATA_DIR=/data
VOLUME /data
USER pwuser
CMD ["node", "/app/bot.mjs"]
