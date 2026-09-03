# Base image with official Playwright dependencies and Node.js
FROM mcr.microsoft.com/playwright:v1.50.0-noble

WORKDIR /app

# Install dependencies
COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

# Generate Prisma Client
RUN npx prisma generate

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

# Start Next.js server
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
