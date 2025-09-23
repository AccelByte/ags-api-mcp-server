# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install

COPY . .
RUN npm run build
RUN npm prune --omit=dev

# Runtime stage
FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache curl

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/openapi-specs ./openapi-specs

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=5 \
  CMD curl -sf http://127.0.0.1:3000/health >/dev/null || exit 1

CMD ["node", "--enable-source-maps", "dist/index.js"]
