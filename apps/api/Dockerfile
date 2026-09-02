FROM node:24.19.0-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/api/package.json ./apps/api/
COPY apps/ui/package.json ./apps/ui/
COPY packages/domain/package.json ./packages/domain/
COPY packages/protocol/package.json ./packages/protocol/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/domain/node_modules ./packages/domain/node_modules
COPY --from=deps /app/packages/protocol/node_modules ./packages/protocol/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
RUN pnpm --filter @dungeon-crawler/domain build
RUN pnpm --filter @dungeon-crawler/protocol build
RUN pnpm --filter @dungeon-crawler/shared build
RUN pnpm --filter @dungeon-crawler/api build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache wget

COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/domain/package.json ./packages/domain/
COPY --from=builder /app/packages/domain/dist ./packages/domain/dist
COPY --from=builder /app/packages/protocol/package.json ./packages/protocol/
COPY --from=builder /app/packages/protocol/dist ./packages/protocol/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/domain/node_modules ./packages/domain/node_modules
COPY --from=deps /app/packages/protocol/node_modules ./packages/protocol/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules

EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
