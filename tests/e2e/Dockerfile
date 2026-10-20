# Playwright runner image (browsers preinstalled); version must match @playwright/test.
FROM mcr.microsoft.com/playwright:v1.56.1-noble
WORKDIR /e2e
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
CMD ["npx", "playwright", "test"]
