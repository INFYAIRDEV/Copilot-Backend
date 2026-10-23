# ---------- Builder Stage ----------
    FROM node:22-slim AS builder

    WORKDIR /app
    
    # Required for Prisma and HTTPS
    RUN apt-get update && apt-get install -y \
        openssl \
        ca-certificates \
        && rm -rf /var/lib/apt/lists/*
    
    # Copy package files first (better cache)
    COPY package*.json ./
    
    # Install all dependencies
    RUN npm ci
    
    # Copy Prisma schema first
    COPY prisma ./prisma
    
    # Generate Prisma client
    RUN npx prisma generate
    
    # Copy remaining app files
    COPY tsconfig*.json ./
    COPY server.ts ./
    COPY cron-runner.ts ./
    COPY src ./src
    
    # Build application
    RUN npm run build

    # Copy runtime translation files
    RUN mkdir -p dist/src/shared/translation/locales && \
        cp -r src/shared/translation/locales/* dist/src/shared/translation/locales/
    
    # Remove dev dependencies
    RUN npm prune --omit=dev
    
    # Clean npm cache
    RUN npm cache clean --force
    
    
    # ---------- Production Runner Stage ----------
    FROM node:22-slim AS runner
    
    WORKDIR /app
    
    ENV NODE_ENV=production
    
    # Required for Prisma runtime
    RUN apt-get update && apt-get install -y \
        openssl \
        ca-certificates \
        && rm -rf /var/lib/apt/lists/*
    
    # Copy runtime files only
    COPY --from=builder /app/package*.json ./
    COPY --from=builder /app/node_modules ./node_modules
    COPY --from=builder /app/dist ./dist
    # Keep runtime translation assets explicit; i18n resolves them relative to dist/src/shared/translation.
    COPY --from=builder /app/src/shared/translation/locales ./dist/src/shared/translation/locales
    COPY --from=builder /app/prisma ./prisma
    
    EXPOSE 8080
    
    CMD ["node", "--max-old-space-size=4096", "dist/server.js"]
