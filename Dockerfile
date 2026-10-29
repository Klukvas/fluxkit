# syntax=docker/dockerfile:1
#
# Production images of Fluxkit (docs/deployment.md, plan docs/plans/2026-10-29-production-deploy.md). One build of the
# workspace, three targets:
#   docker build --target api        -t fluxkit-api .
#   docker build --target storefront -t fluxkit-storefront --build-arg STOREFRONT_IMAGE_HOSTS=... .
#   docker build --target edge       -t fluxkit-edge .
# No secret is read at build time and none is baked into an image: every runtime setting comes from the environment.
#
# Why no `turbo prune` or `pnpm deploy`: the API loads feature and provider packages by scanning `packages/features` and
# `packages/providers` at start (they are not dependencies of @fluxkit/api in the lockfile graph), and the migrator reads
# `apps/api/drizzle` relative to its own file. The runtime images therefore keep the monorepo layout that the tests run.

ARG NODE_IMAGE=node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.29.8-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6

# --- pnpm on Node (build stages only; the runtime stages carry no package manager) ---
FROM ${NODE_IMAGE} AS pnpm
ENV PNPM_HOME=/pnpm \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1 \
    DO_NOT_TRACK=1 \
    CI=true
ENV PATH="${PNPM_HOME}:${PATH}"
WORKDIR /app
COPY package.json ./
# The version comes from `packageManager` (pnpm@10.28.0).
RUN corepack enable && corepack prepare --activate

# --- every package of the lockfile in the store (cached until the lockfile changes) ---
FROM pnpm AS fetch
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch --frozen-lockfile

# --- the whole workspace, installed and built ---
FROM fetch AS build
COPY . .
RUN pnpm install --offline --frozen-lockfile
# Read by `next build` for the storefront CSP (image hosts): set the SAME value at run time (docs/deployment.md).
ARG STOREFRONT_IMAGE_HOSTS=""
ENV STOREFRONT_IMAGE_HOSTS=${STOREFRONT_IMAGE_HOSTS}
RUN pnpm build

# --- production dependencies only, for one app, in the monorepo layout ---
FROM build AS prune
# Drop every installed module and the outputs no runtime image needs, then reinstall production dependencies per target.
RUN find . -name node_modules -type d -prune -exec rm -rf {} + \
 && rm -rf apps/admin/dist apps/storefront/.next/cache .turbo

FROM prune AS api-tree
RUN rm -rf apps/storefront/.next \
 && pnpm install --offline --frozen-lockfile --prod \
      --filter "@fluxkit/api..." --filter "./packages/features/*..." --filter "./packages/providers/*..."

FROM prune AS storefront-tree
RUN pnpm install --offline --frozen-lockfile --prod --filter "@fluxkit/storefront..."

# --- runtime base: Node only, files owned by root (read-only for the process), the process runs as `node` (uid 1000) ---
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    NO_COLOR=1 \
    NEXT_TELEMETRY_DISABLED=1
# The package managers of the base image are not needed at run time.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg

# --- the API (also runs the scheduler, the migrator and the admin commands) ---
FROM runtime AS api
COPY --from=api-tree /app /app
# MEDIA_DIR of the Compose example. A named volume mounted here starts with this owner and mode (0750, ADR 0028).
RUN mkdir -p /var/lib/fluxkit/media && chown node:node /var/lib/fluxkit/media && chmod 0750 /var/lib/fluxkit/media
WORKDIR /app/apps/api
USER node
ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# Other commands of this image (docs/deployment.md): dist/database/migrate.js, dist/jobs/run-once.js,
# dist/auth/create-admin.js, dist/auth/unlock-admin.js.
CMD ["node", "dist/main.js"]

# --- the storefront (`next start`, the way the e2e suite runs it) ---
FROM runtime AS storefront
COPY --from=storefront-tree /app /app
# `next start` writes its fetch and image caches here; with a read-only root mount a tmpfs on it (Compose example).
RUN mkdir -p /app/apps/storefront/.next/cache && chown node:node /app/apps/storefront/.next/cache
ARG STOREFRONT_IMAGE_HOSTS=""
ENV STOREFRONT_IMAGE_HOSTS=${STOREFRONT_IMAGE_HOSTS}
WORKDIR /app/apps/storefront
USER node
EXPOSE 3001
# `/` answers a redirect to the default locale without calling the API, so this checks the Next server only.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/',{redirect:'manual'}).then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"]
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3001"]

# --- the edge proxy: nginx (non-root, ports 8080 and 8443) with the built admin SPA (ADR 0027) ---
FROM ${NGINX_IMAGE} AS edge
USER root
RUN rm -f /etc/nginx/conf.d/default.conf && mkdir -p /var/www/acme && chown 101:101 /var/www/acme
COPY --from=build /app/apps/admin/dist /srv/fluxkit/site/admin-ui
COPY infra/proxy/nginx/templates/ /etc/nginx/templates/
COPY infra/proxy/nginx/snippets/ /etc/nginx/fluxkit/
COPY --chmod=0755 infra/proxy/nginx/16-fluxkit-env.envsh /docker-entrypoint.d/16-fluxkit-env.envsh
USER 101
# Only our variables (and the resolver the entrypoint finds) are substituted into the templates, never nginx's own `$host`.
ENV NGINX_ENVSUBST_FILTER="^(FLUXKIT_|NGINX_LOCAL_RESOLVERS)" \
    NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1 \
    NGINX_ENTRYPOINT_QUIET_LOGS=1
EXPOSE 8080 8443
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8081/.edge-health"]
