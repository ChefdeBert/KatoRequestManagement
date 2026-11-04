# syntax=docker/dockerfile:1.7
# Multi-target image:  `--target app` (Next.js)  ·  `--target worker` (BullMQ worker + migrations)

ARG NODE_IMAGE=node:20-bookworm-slim

FROM ${NODE_IMAGE} AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ── Dependencies ────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then npm ci; else npm install; fi

# ── Build ───────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
RUN npx prisma generate && npm run build && npm run build:worker

# ── Production node_modules for the worker (keeps prisma CLI for migrate deploy)
FROM deps AS prod-deps
RUN npx prisma generate && npm prune --omit=dev

# ── App runtime ─────────────────────────────────────────────────────
FROM base AS app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 kato && useradd --system --uid 1001 --gid kato kato
COPY --from=build --chown=kato:kato /app/public ./public
COPY --from=build --chown=kato:kato /app/.next/standalone ./
COPY --from=build --chown=kato:kato /app/.next/static ./.next/static
USER kato
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]

# ── Worker runtime ──────────────────────────────────────────────────
FROM base AS worker
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 kato && useradd --system --uid 1001 --gid kato kato
COPY --from=prod-deps --chown=kato:kato /app/node_modules ./node_modules
COPY --from=build --chown=kato:kato /app/dist ./dist
COPY --chown=kato:kato prisma ./prisma
COPY --chown=kato:kato package.json ./
USER kato
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/worker.js"]
