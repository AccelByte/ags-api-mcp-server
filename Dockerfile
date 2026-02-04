# Build stage
FROM node:24-alpine AS builder
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build
RUN pnpm prune --prod

# Runtime stage
FROM node:24-alpine
WORKDIR /app

RUN apk add --no-cache curl

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/openapi-specs ./openapi-specs

ENV NODE_ENV=production \
    MCP_PORT=3000 \
    MCP_PATH=/mcp

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=5 \
  CMD curl -sf http://127.0.0.1:3000/health >/dev/null || exit 1

# Use V2 architecture (stateless, HTTP-only)
CMD ["node", "--enable-source-maps", "dist/v2/index.js"]
