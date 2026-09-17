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
# Which commit this image is. THE FALLBACK, not the primary: Render sets
# RENDER_GIT_COMMIT on the running service and /api/version prefers that. These
# exist for everywhere else — a plain `docker build`, another host — because a
# build that cannot say what it is makes every later verification unfalsifiable.
# `.git` is excluded by .dockerignore, so this cannot be read here; it has to be
# passed in: docker build --build-arg EMDR_BUILD_COMMIT=$(git rev-parse HEAD)
ARG EMDR_BUILD_COMMIT=""
ARG EMDR_BUILD_BRANCH=""
ARG EMDR_BUILD_TIME=""
# The repo ships no public assets; ensure the dir exists so the runner COPY succeeds.
RUN mkdir -p public && npm run build

FROM node:22-slim AS runner
WORKDIR /app
# Re-declared: an ARG does not cross stage boundaries, and these are read at
# REQUEST time by /api/version rather than compiled in, so they have to reach
# the runner as environment.
ARG EMDR_BUILD_COMMIT=""
ARG EMDR_BUILD_BRANCH=""
ARG EMDR_BUILD_TIME=""
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    EMDR_DATA_DIR=/data \
    EMDR_DEMO=1 \
    EMDR_BUILD_COMMIT=$EMDR_BUILD_COMMIT \
    EMDR_BUILD_BRANCH=$EMDR_BUILD_BRANCH \
    EMDR_BUILD_TIME=$EMDR_BUILD_TIME
RUN mkdir -p /data && chown node:node /data
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
