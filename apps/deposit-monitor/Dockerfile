# syntax=docker/dockerfile:1.7

# ── Stage 1: Dependencies ───────────────────────────────────────────────────
FROM node:22.11-alpine@sha256:6e0e3a1f4c8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e AS deps
RUN corepack enable pnpm
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/deposit-monitor/package.json ./apps/deposit-monitor/
COPY packages/stellar/package.json ./packages/stellar/
RUN pnpm install --frozen-lockfile

# ── Stage 2: Builder ────────────────────────────────────────────────────────
FROM node:22.11-alpine@sha256:6e0e3a1f4c8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e AS builder
RUN corepack enable pnpm
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
WORKDIR /app/apps/deposit-monitor
RUN pnpm build

# ── Stage 3: Production dependencies ────────────────────────────────────────
FROM node:22.11-alpine@sha256:6e0e3a1f4c8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e AS prod-deps
RUN corepack enable pnpm
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/deposit-monitor/package.json ./apps/deposit-monitor/
COPY packages/stellar/package.json ./packages/stellar/
RUN pnpm install --frozen-lockfile --prod

# ── Stage 4: Runner ─────────────────────────────────────────────────────────
FROM node:22.11-alpine@sha256:6e0e3a1f4c8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e AS runner

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
WORKDIR /app

COPY --from=prod-deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder  --chown=nodejs:nodejs /app/apps/deposit-monitor/dist ./dist
COPY --from=builder  --chown=nodejs:nodejs /app/packages/stellar ./packages/stellar

ENV NODE_ENV=production
USER nodejs

STOPSIGNAL SIGTERM

CMD ["node", "dist/index.js"]
