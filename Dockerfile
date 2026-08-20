FROM node:20-bookworm-slim AS base

ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

FROM base AS deps

# Both manifests, and `npm ci` rather than `npm install`. The build used to
# copy package.json alone and run `npm install`, so the lockfile was ignored
# entirely and every rebuild could resolve different transitive versions —
# the image you tested was not necessarily the image you shipped.
COPY package.json package-lock.json ./

RUN npm ci

FROM base AS builder

# No NEXT_PUBLIC_* build args needed — auth is server-side JWT/cookie based
# (no client-side config to bake into the bundle), and object storage
# (Cloudinary) is only ever accessed from the server.

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

FROM base AS runner

ENV NODE_ENV=production
ENV PORT=4000
ENV HOSTNAME=0.0.0.0

# curl for the healthcheck below; cleaned up in the same layer so it doesn't
# persist in the image.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

# output: "standalone" (next.config.ts) traces only the dependencies this
# app actually uses into .next/standalone, including its own minimal
# server.js. Static assets and public/ aren't included in standalone output
# and have to be copied in separately.
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# The server ran as root. Nothing it does needs root, and a container escape
# from a root process is a far worse day than one from an unprivileged one.
# node:20 images ship a `node` user for exactly this.
USER node

EXPOSE 4000

# Without this, an orchestrator could not tell a healthy process from one
# wedged on an unreachable database — the container stayed "up" while every
# request 500'd. /api/health runs a real SELECT 1.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4000/api/health || exit 1

CMD ["node", "server.js"]
