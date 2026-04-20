# Playwright base image. The Chromium that ships with this image is pinned
# to Playwright 1.59.1 — so we also pin the npm playwright package to 1.59.1.
# We additionally run `playwright install chromium` at build time so the
# browser is guaranteed to match whatever the npm package expects (works
# around Railway's image/layer caching).
FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app

# Copy manifests first for better Docker layer caching
COPY package.json package-lock.json* ./

# Install deps. Do it as root so postinstall / playwright install have write
# access to /ms-playwright.
USER root
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

# Force the Chromium binary to match the installed Playwright version.
RUN npx playwright install --with-deps chromium

# Build
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# Railway requires listening on $PORT
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/index.js"]
