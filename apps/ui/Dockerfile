FROM node:24.19.0-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/api/package.json ./apps/api/
COPY apps/ui/package.json ./apps/ui/
COPY packages/domain/package.json ./packages/domain/
COPY packages/protocol/package.json ./packages/protocol/
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/ui/node_modules ./apps/ui/node_modules
COPY --from=deps /app/packages/domain/node_modules ./packages/domain/node_modules
COPY --from=deps /app/packages/protocol/node_modules ./packages/protocol/node_modules
COPY . .
RUN pnpm --filter @dungeon-crawler/domain build
RUN pnpm --filter @dungeon-crawler/protocol build
RUN pnpm --filter @dungeon-crawler/ui build

FROM nginx:alpine AS runner
COPY --from=builder /app/apps/ui/dist /usr/share/nginx/html
COPY apps/ui/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
