# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @taxi/api build && pnpm --filter @taxi/web build
RUN pnpm --filter @taxi/api deploy --legacy --prod /out/api && cp -r apps/api/dist apps/api/drizzle /out/api/

FROM node:22-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/api ./
USER node
EXPOSE 3000
# Migrations are idempotent and run before every start.
CMD ["sh", "-c", "node dist/migrate.js && node dist/server.js"]

FROM caddy:2.10-alpine AS web
COPY --from=build /repo/apps/web/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
