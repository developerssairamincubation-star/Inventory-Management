FROM node:20-bookworm-slim AS base

ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

FROM base AS deps

COPY package.json ./

RUN npm install

FROM base AS builder

# No NEXT_PUBLIC_* build args needed anymore — auth is server-side JWT/cookie
# based (no client-side Firebase config to bake into the bundle), and object
# storage (Cloudinary) is only ever accessed from the server.

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

FROM base AS runner

ENV NODE_ENV=production
ENV PORT=4000
ENV HOSTNAME=0.0.0.0

# output: "standalone" (next.config.ts) traces only the dependencies this
# app actually uses into .next/standalone, including its own minimal
# server.js — a much smaller image than shipping the full node_modules.
# Static assets and public/ aren't included in standalone output and have
# to be copied in separately.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 4000

CMD ["node", "server.js"]
