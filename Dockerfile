# syntax=docker/dockerfile:1

# --- build -------------------------------------------------------------------------------------

FROM node:22-slim AS build

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

WORKDIR /src

RUN corepack enable

# Dependencies first: a source-only change then reuses this layer instead of re-resolving the tree.
# `--ignore-scripts` skips the `nuxt prepare` postinstall, which needs sources that aren't here yet -
# `nuxt build` runs it itself further down.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN pnpm build

# --- runtime -----------------------------------------------------------------------------------

FROM node:22-slim

# Nitro's build output is self-contained - it carries the server, the client bundle and whatever
# dependencies could not be inlined - so the runtime image needs no package manager and no install.
COPY --from=build /src/.output /app

# State lives in Postgres, not in the image - point `DATABASE_URL` at one or the container exits on
# boot. This directory is only read, and only once: mount an old deployment's JSON files over it and
# the first start against an empty database carries them in.
RUN mkdir -p /bot/data && chown -R node:node /bot

# `DATA_DIR` is resolved against the working directory, so this is where that mount is looked for.
WORKDIR /bot

# Run as a non-root user.
USER node:node

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/bot/data

# Web dashboard; publish with -p at runtime.
EXPOSE 8080/tcp

# `/api/state` is the one route reachable without a login and without Discord, so it answers as soon
# as the process is genuinely serving - which is exactly what a health check should wait for.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/state').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD [ "node", "/app/server/index.mjs" ]
