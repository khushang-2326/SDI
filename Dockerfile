# Base image with official Playwright dependencies and Node.js
FROM mcr.microsoft.com/playwright:v1.50.0-noble

WORKDIR /app

# Install dependencies
COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci
RUN npx playwright install chromium

# Ensure absolute SQLite path
ENV DATABASE_URL="file:/app/prisma/dev.db"

# Generate Prisma Client & push initial schema
RUN npx prisma generate
RUN npx prisma db push --accept-data-loss
RUN cp -f /app/prisma/dev.db /app/dev.db 2>/dev/null || true

# Copy source code
COPY . .

# Build Next.js application
RUN npm run build

# Expose port
EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production
ENV QUEUE_PROVIDER=local
ENV STORAGE_PROVIDER=local

# Start Next.js server with auto-migrated database
CMD ["sh", "-c", "npx prisma generate || true; npx prisma db push --accept-data-loss || true; cp -f /app/prisma/dev.db /app/dev.db 2>/dev/null || true; cp -f /app/dev.db /app/prisma/dev.db 2>/dev/null || true; npm start"]
