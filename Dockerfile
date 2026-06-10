# Demo deployment image. Runs the app with an on-container SQLite database.
# For a persistent demo, mount a volume at /data; without one, data resets on
# every restart (which is fine — the demo dataset reseeds itself).

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The repo ships no public assets; ensure the dir exists so the runner COPY succeeds.
RUN mkdir -p public && npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    EMDR_DATA_DIR=/data \
    EMDR_DEMO=1
RUN mkdir -p /data && chown node:node /data
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
