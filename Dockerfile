FROM node:20-bookworm-slim AS base

ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

FROM base AS deps

COPY package.json ./

RUN npm install

FROM base AS builder

# No NEXT_PUBLIC_* build args needed anymore — auth is server-side JWT/cookie
# based (no client-side Firebase config to bake into the bundle), and object
# storage (MinIO) is only ever accessed from the server.

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build && npm prune --omit=dev

FROM base AS runner

ENV NODE_ENV=production
ENV PORT=4000
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next

EXPOSE 4000

CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0"]