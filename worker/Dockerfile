# Playwright base image with Chromium preinstalled + system deps
FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app

# Copy manifests first for better Docker layer caching
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

# Copy source + build
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# Railway requires listening on $PORT
ENV PORT=8080
EXPOSE 8080

# Non-root user for security (playwright image ships with pwuser)
USER pwuser

CMD ["node", "dist/index.js"]
