# Production deployment

How to run one shop built from this template on one Linux host with Docker, and what to check before it takes real orders.
Plan and decisions: `docs/plans/2026-10-29-production-deploy.md`. Architecture: ADR 0024 (trusted proxy hops), 0026 (one origin), 0027 (admin SPA under `/admin-ui/`), 0028 (media), 0032 (payment webhook).

## What exists and what was verified

| Piece | File | Verified |
|---|---|---|
| Images `api`, `storefront`, `edge` | `Dockerfile` (one file, three targets), `.dockerignore` | Built with Docker 29.8 / BuildKit; run by `scripts/deploy-smoke.sh` |
| Compose example | `infra/docker-compose.prod.yml`, `infra/production.env.example` | Started healthy by the smoke test, including the `meilisearch` service and the search steps (read-only roots, migrate before start; non-root users except the engine, which runs as root inside its container under `read_only`, `cap_drop: ALL` and `no-new-privileges`: the image has no `USER`) |
| Edge proxy (nginx, default) | `infra/proxy/nginx/` (templates, snippet, start-up script) | `nginx -t` in the running edge; routing, headers, TLS, body limits, client address forwarding by the smoke test |
| Edge proxy (Caddy, alternative) | `infra/proxy/caddy/Caddyfile` | `caddy validate` and `caddy fmt` (Caddy 2.10.2); the admin SPA headers, `X-Forwarded-For` replacement, HSTS and the webhook body limit against a stub upstream. Not run with the real API or storefront, no ACME certificate |
| Automatic deployment | `.github/workflows/deploy.yml`, `infra/deploy/fluxkit-deploy` (section "Automatic deployment") | `actionlint`, `shellcheck`; the host script against a fake `docker` (arguments, order, return to the previous release); first real run on the test server 2026-11-12 (`7349a1b` to `ad1e09d`: pull, backup, switch, healthy, site checked; `docs/plans/2026-11-10-hetzner-first-deploy.md`, section 16). The return to the previous release has not run on a real host |
| Smoke test | `scripts/deploy-smoke.sh` (CI job `deploy-smoke`) | Passes locally and in the CI job `deploy-smoke` on GitHub (green for the search engine change, 2026-11-04) |
| Header copies | `apps/admin/edge-proxy-headers.spec.ts` | Fails when the nginx copy of the `/admin-ui` headers drifts from `apps/admin/security-headers.ts` |
| `.env.example` completeness | `scripts/check-env-example.mjs` (`pnpm check:env`, CI `verify`) | Fails when the code reads a variable `.env.example` does not list |

Not verified anywhere: a certificate from a real CA, real DNS and public traffic, IPv6 clients, a payment provider calling the webhook, real mail, a restore from backup, an update of a running shop that runs a new migration, more than one host.

## Topology

```
internet ──80/443──▶ edge (nginx, uid 101; TLS, routing, admin SPA files)
                       ├── /store, /admin, /media, /webhooks/{payments,email} ──▶ api:3000 (Node, uid 1000; also the scheduler)
                       ├── /admin-ui ──────────────────────────────────▶ files in the edge image (index.html fallback)
                       └── everything else ────────────────────────────▶ storefront:3001 (next start, uid 1000)
storefront ──API_INTERNAL_URL=http://api:3000──▶ api   (catalog reads of the Next server, no cookies)
migrate (api image, runs once per `up`) ──▶ postgres:5432 ◀── api
api ──MEILI_URL=http://meilisearch:7700──▶ meilisearch (Community Edition; no published port, not routed by the edge)
api ──REDIS_URL (RATE_LIMIT_STORE=redis)──▶ redis (password, no persistence, no published port)
volumes: postgres-data, meili-data, media (MEDIA_DIR), acme-webroot
```

- Only the edge publishes ports. The API's `/docs`, `/docs-json` and `/health` are not routed (they answer the storefront's 404); Swagger UI in production is not public (owner's decision 2026-11-14, `docs/plans/2026-11-14-swagger-in-production.md`): keep it unrouted.
- **Meilisearch is part of the example** (catalog search, ADR 0034; image pinned to the version CI tests, by digest, `MEILI_ENV=production`). It is reachable only by the API on the Compose network; the browser never talks to it. `api` waits for it to be healthy even with search off, so a broken engine stops the boot instead of failing later. The index is rebuilt from Postgres, so `meili-data` is a cache, not a backup target.
- **Redis is part of the example** (2026-11-14, `docs/plans/2026-11-14-multi-instance.md`, PR 1 of 4): unmodified `redis:8.12.0-alpine` (pinned by digest) under the approved AGPLv3 exception (`docs/dependencies.md`), password `REDIS_PASSWORD`, reachable only on the Compose network, run as the image's `redis` user with the same hardening as the other services. It holds counters only: no RDB snapshots, no append-only file, `maxmemory 128mb` with `volatile-ttl`, nothing to back up. The example API reads it only with `REDIS_URL` and `RATE_LIMIT_STORE=redis` in `production.env` ("Shared rate limits" below, ADR 0055); `api` waits for it to be healthy either way, because with `redis` selected the API refuses to start while Redis does not answer. `deploy-smoke` checks it is healthy, publishes no port, refuses a client without the password and persists nothing.
- **Infrastructure images are pinned by tag and digest** (Postgres `17.12-alpine`, Redis `8.12.0-alpine`, Meilisearch `v1.55.0`; deploy review D13, `docs/plans/2026-11-27-deploy-review.md`): each deploy pulls the whole project, so a floating tag would recreate the database or Redis inside an application release. Dependabot proposes updates (`docker-compose` ecosystem); a Postgres image update is a planned change with a backup, not part of an application release.
- **Replicas on one host:** `FLUXKIT_API_REPLICAS` and `FLUXKIT_STOREFRONT_REPLICAS` are positive integers, default 1. More than one API requires `RATE_LIMIT_STORE=redis` and the private `REDIS_URL`; the host deploy script refuses an unsafe count before pulling images. The named `media` volume is mounted by every API replica. The scheduler runs in every API under one Postgres advisory lock (jobs 1 to 14); there is no worker image. With `SCHEDULER_ENABLED=false`, use a host cron (`docker compose ... run --rm api node dist/jobs/run-once.js`). Each API and storefront replica has a **1 GB memory limit**; rolling deploys temporarily run old + new replicas of one service. Check host memory before scaling. Multi-host media needs object storage and is outside this example (ADR 0057).

## Prerequisites

- A Linux host with Docker Engine 25 or newer and Compose v2.20 or newer (`up --wait`), about 2 GB RAM free for the API (image uploads need about 512 MB of headroom, ADR 0028), 1 GB for the storefront, and disk for Postgres, the media volume and the images (`api` about 560 MB, `storefront` about 1 GB, `edge` about 85 MB, measured 2026-10-29).
- A DNS name for the shop pointing at the host, ports 80 and 443 open.
- A TLS certificate for that name (see TLS). The host must reach its own public address on 443 (hairpin): the Next image optimizer fetches uploaded images from `https://<domain>/media/...` from inside the storefront container and refuses private addresses (ADR 0028, README "Uploaded images").
- The repository checked out on the host (or images built elsewhere and pushed to a registry: set `FLUXKIT_IMAGE_PREFIX` and `FLUXKIT_IMAGE_TAG`; section "Automatic deployment").

## Configuration

`cp infra/production.env.example infra/production.env`, fill it in, `chmod 600 infra/production.env`; likewise `cp infra/meilisearch.env.example infra/meilisearch.env` for the engine's master key (`FLUXKIT_MEILI_ENV_FILE` points elsewhere). The file is git-ignored. Compose reads it for the `${...}` values of `infra/docker-compose.prod.yml` (`--env-file`), and the `api` and `migrate` containers get all of it as their environment. The storefront and the edge get only their own variables. Nothing secret is built into an image.

Secrets (generate, store in a password manager, back up with the database where noted):

| Variable | Generate | Note |
|---|---|---|
| `POSTGRES_PASSWORD` | `openssl rand -hex 32` | Hex only: it is placed unescaped into `DATABASE_URL` by the Compose file |
| `REDIS_PASSWORD` | `openssl rand -hex 32` | Hex only (it will stand unescaped in `REDIS_URL`). Required by the Compose file since 2026-11-14: an existing host must add it to `production.env` BEFORE it deploys a release with Redis, or `compose pull` stops the deployment (the running release is untouched). Nothing to back up |
| `MEILI_MASTER_KEY` | `openssl rand -hex 32` | At least 16 bytes. Not in `production.env`: it is in `infra/meilisearch.env` (template `infra/meilisearch.env.example`, `chmod 600`, git-ignored), read only by the engine container, so the API process never holds a key that can mint other keys. Used once to create the scoped key |
| `MEILI_API_KEY` | created once, see "Catalog search" | The scoped key the API uses; never the master key. Needed only with `SEARCH_ENABLED=true` |
| `ORDER_TOKEN_SECRET` | `openssl rand -base64 48` | At least 32 characters. Changing it breaks the links of unpaid guest orders and every emailed reset or verification link (ADR 0023, 0031): keep it with the database backup |
| `MONOBANK_TOKEN` | Monobank business cabinet | Only with `PAYMENT_PROVIDERS_ENABLED=monobank`; never logged |
| `RESEND_API_KEY` | Resend dashboard (sending-only key) | Required whenever `resend` is selected as primary or fallback |
| `BREVO_API_KEY` | Brevo API key (not SMTP credential) | Required whenever `brevo` is selected as primary or fallback |
| `RESEND_WEBHOOK_SECRET` | Resend endpoint signing secret | Required when a fallback chain includes `resend`; see "Email suppression webhooks" |
| `BREVO_WEBHOOK_SECRET` | Dedicated URL-safe bearer token, at least 43 characters | Required when a fallback chain includes `brevo`; never reuse its API key |
| `NOVA_POST_API_KEY` | Nova Post business cabinet | Only with `SHIPPING_PROVIDERS_ENABLED=nova_post` |
| `ADMIN_PASSWORD` | the owner's choice, 12 to 128 characters | Not in the file: given once to the create-admin command (below) |

Set by the Compose file (do not put them in the env file): `NODE_ENV=production`, `PORT=3000`, `DATABASE_URL` (from `POSTGRES_*`), `STOREFRONT_PUBLIC_URL=https://<FLUXKIT_DOMAIN>`, `MEDIA_STORAGE_DRIVER=local`, `MEDIA_DIR=/var/lib/fluxkit/media`, `MEDIA_PUBLIC_BASE_URL=https://<FLUXKIT_DOMAIN>/media`, `MEILI_URL=http://meilisearch:7700`, `API_INTERNAL_URL=http://api:3000` (storefront).

Required in the env file: `FLUXKIT_DOMAIN`, `FLUXKIT_CERTS_DIR`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `ORDER_TOKEN_SECRET`, `TRUST_PROXY`, plus `MEILI_MASTER_KEY` in `infra/meilisearch.env`. Everything else has a default (`.env.example` and `docs/contracts/config.md` explain each variable; `pnpm check:env` keeps `.env.example` complete).

- `TRUST_PROXY=1` matches the example (the edge is the only proxy and replaces `X-Forwarded-For`). With a CDN or load balancer in front of the edge it becomes 2, and the edge must then APPEND instead of replace (`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` in `infra/proxy/nginx/snippets/forwarded-headers.conf`, the ONE snippet that both the API locations and the storefront location include, so the change covers the search results page too; ADR 0038): too high lets a client choose its rate-limit key, too low puts every shopper into one window (ADR 0024, README "Deployment notes").
- `STOREFRONT_FORWARD_CLIENT_ADDRESS=true` (the example's value; ADR 0038) makes the storefront pass the edge's `X-Forwarded-For` on to the API for the search results page, so its `search` window counts shoppers. **The storefront must be reachable only through the edge when this is on** (the Compose example publishes no storefront port): a client that reaches `next start` directly would choose its own rate-limit key, or use up another address's window. Unset or `false`: every results page counts as the Next server's one address (one shared window for page searches; the browser's own `/store/*` calls stay per shopper).
- `STOREFRONT_DEMO_NOTICE=true` is for a public template demo only (default `false`; exactly `true` or `false`, blank means unset). Compose passes it to the storefront at runtime; recreate the storefront with the updated environment, without rebuilding the image. It shows a permanent strip, a first-visit dialog and a checkout warning with uk/en FluxLab links (`utm_source=fluxkit-demo&utm_medium=demo-notice`). Before opening, the dialog records the visit in `localStorage` (`fluxkit_demo_notice_seen`, fixed value `true`); an existing key or a failed read/write keeps it closed and the strip remains. Leave unset in client shops. This is a notice only: it does not disable payments or change order processing; the demo deployment must use demo data and test providers.
- The hop count of each set-up, and the check from two networks: "Proxy hops" and "Checking per-address limits" below.
- `STOREFRONT_IMAGE_HOSTS` is frozen into the storefront's CSP when the image is BUILT (Compose passes it as a build argument and again at run time) and becomes the admin's `img-src` at the edge: rebuild the storefront after a change. With uploads in use, the shop's own domain belongs in it.
- `ADMIN_COOKIE_SECURE` and `STORE_COOKIE_SECURE` stay `true` (HTTPS).
- With `EMAIL_PROVIDER=none` and blank `EMAIL_FALLBACK_PROVIDERS`, the API logs one warning at start; password reset and order mail are off (`docs/api/customers.md`). A fallback list cannot enable an absent primary.
- Recommended email route: `EMAIL_PROVIDER=resend`, `EMAIL_FALLBACK_PROVIDERS=brevo`; keep fallback blank for a single provider. Every selected service needs its own send key, verified sender and authenticated suppression webhook. See "Ordered email fallback and usage" before enabling it.

### Proxy hops (`TRUST_PROXY`) per set-up

Count the proxies between the internet and the API that set or append `X-Forwarded-For`. The Next server is not counted: the edge routes `/store/*` straight to the API, and with `STOREFRONT_FORWARD_CLIENT_ADDRESS=true` the Next server passes the edge's chain on unchanged (ADR 0038), so the API sees the same chain on both paths.

| Set-up | Chain the API receives | `TRUST_PROXY` | `STOREFRONT_FORWARD_CLIENT_ADDRESS` |
|---|---|---|---|
| nginx edge of the Compose example (`infra/proxy/nginx`, replaces the header with `$remote_addr`) | `X-Forwarded-For: <client>`, socket = edge (or the Next server on the results page) | `1` | `true` (only the edge publishes ports) |
| Caddy edge (`infra/proxy/caddy/Caddyfile`, no `trusted_proxies`: Caddy replaces the header of a client it does not trust) | the same | `1` | `true` when the storefront is reachable only through Caddy |
| CDN or load balancer in front of nginx (the edge APPENDS: `$proxy_add_x_forwarded_for`) | `<client>, <cdn node>` | `2` | `true` |
| CDN in front of Caddy (Caddy's `trusted_proxies` set to the CDN's ranges, so it appends) | `<client>, <cdn node>` | `2` | `true` |
| Development: `next dev` rewrite, no edge (the rewrite passes a browser-sent header through, ADR 0026) | whatever the browser sent | `0` | `false` (unset) |

### Checking per-address limits

After a deployment, from two different networks (for example a computer on the home network as A, a phone on mobile data with Wi-Fi off as B), within one minute. These routes cost nothing and their windows reset after a minute; do not use the admin login for this (a used-up login window locks your own address out of the admin for 10 minutes).

1. On the host, the values: `grep -E '^(TRUST_PROXY|STOREFRONT_FORWARD_CLIENT_ADDRESS)=' <env file>` shows the row of the table above.
2. The `/store/*` path (edge to API), window `searchSuggest`, 120 a minute. From A:
   `for i in $(seq 1 125); do curl -s -o /dev/null -w '%{http_code}\n' 'https://<domain>/store/search/suggest?q=ab'; done | sort | uniq -c`
   prints about `120 200` and `5 429`. At once, B opens `https://<domain>/store/search/suggest?q=ab`: JSON, not `too_many_requests`. A again, with an invented address: `curl -s -o /dev/null -w '%{http_code}\n' -H 'X-Forwarded-For: 198.51.100.7' 'https://<domain>/store/search/suggest?q=ab'` prints `429` (a `200` here means a client can choose its key: `TRUST_PROXY` too high for an edge that appends, or the edge does not replace the header). B refused too means every client shares one window (`TRUST_PROXY` too low, or IPv6 clients behind `docker-proxy`, above).
3. The results page path (`STOREFRONT_FORWARD_CLIENT_ADDRESS`), window `search`, 60 a minute. After a minute, from A:
   `for i in $(seq 1 65); do curl -s -o /dev/null "https://<domain>/uk/search?q=test$i"; done; curl -s -o /dev/null -w '%{http_code}\n' 'https://<domain>/store/search?q=x'`
   prints `429`: the pages used up A's own window. B searches on the site at once and gets results. If A prints `200` and B sees the search error instead, the pages counted the Next server's one address: the setting is off or the edge does not set the header on page requests (every shopper then sees that error for up to a minute, so run this step on a quiet shop).
4. The catalog reads (`catalogRead`, 300 a minute, `docs/api/catalog.md`): the same as step 2 with `/store/config` and 305 requests.

## Build and first start

```bash
docker compose --env-file infra/production.env -f infra/docker-compose.prod.yml build
docker compose --env-file infra/production.env -f infra/docker-compose.prod.yml up -d --wait
# The first owner: asks for the password twice in the terminal (nothing echoed, nothing stored in the env file)
docker compose --env-file infra/production.env -f infra/docker-compose.prod.yml run --rm --no-deps \
  api node dist/auth/create-admin.js --email owner@shop.example
# In a script instead: -T -e ADMIN_PASSWORD (the value from the calling environment; README "Admin sign-in")
```

- `migrate` runs `node dist/database/migrate.js` (forward only, advisory lock, prints the applied migrations) and exits; `api` starts only after it exited 0, the storefront after the API is healthy, the edge after both.
- Other commands of the API image: `node dist/auth/unlock-admin.js --email ...`, `node dist/jobs/run-once.js`. `pnpm seed` refuses production on purpose: no demo data in a live shop.
- Then: sign in at `https://<domain>/admin-ui/`, configure the catalog, prices, shipping methods.

## Catalog search

The API starts with search off (`SEARCH_ENABLED` unset) and needs the scoped key before it can run with search on, so the first start has two steps:

```bash
C="docker compose --env-file infra/production.env -f infra/docker-compose.prod.yml"
$C up -d --wait                       # everything, search still off: the storefront lists products through SQL
# One key scoped to the index prefix, made with the master key INSIDE the engine container (its port is not published):
$C exec -T meilisearch sh -c 'wget -q -O - --header "Authorization: Bearer $MEILI_MASTER_KEY" --header "Content-Type: application/json" \
  --post-data "{\"description\":\"fluxkit API\",\"indexes\":[\"fluxkit_*\"],\"expiresAt\":null,\"actions\":[\"search\",\"documents.add\",\"documents.delete\",\"indexes.create\",\"indexes.delete\",\"indexes.swap\",\"settings.update\",\"settings.get\",\"tasks.get\",\"tasks.delete\",\"stats.get\"]}" \
  http://127.0.0.1:7700/keys'
# Put the "key" field of the answer into infra/production.env as MEILI_API_KEY=..., add SEARCH_ENABLED=true, then:
$C up -d --no-deps --force-recreate --wait api
```

- Use your `MEILI_INDEX_PREFIX` instead of `fluxkit_` in `indexes` when you set one (README "Catalog search" has the same call with `curl`).
- The scheduler builds the indexes on its first tick (jobs 13 and 14); until then `GET /store/search` answers `503 search_unavailable` and the storefront falls back to SQL. After a bulk import or a restore, `docker compose ... run --rm --no-deps api node dist/search/reindex.js` builds at once (exit 2 means a scheduler tick held the lock at that moment: the rebuild is requested and the scheduler does it, or run the command again).
- Never publish the engine's port and never route it through the edge: the index holds public data only, but the engine API must stay private (ADR 0034).
- The engine needs memory for indexing (`mem_limit: 1g` in the example, enough for a small catalog; raise it with the catalog). Losing `meili-data` costs a rebuild, not data.

## Optional features

Feature packages (ADR 0049; the blog, `packages/features/blog/README.md`) are in every image and off until `FEATURES_ENABLED` names
them: the API image holds each feature's package, its `drizzle/` migrations and their hand-written `.down.sql` files; the storefront image
holds the slices found when its registry was generated inside the Docker build (`pnpm build`); the admin SPA holds its slices. One switch,
the API's `FEATURES_ENABLED`, drives all three: the storefront and the admin read `features` of `GET /store/config` and
`GET /admin/config`. No image is rebuilt to switch a feature on or off.

Switching one on (the blog here):

```bash
C="docker compose --env-file infra/production.env -f infra/docker-compose.prod.yml"
# 1. Back up (next sections), then add the name to infra/production.env (comma-separated): FEATURES_ENABLED=blog
# 2. Its migrations: the migrate service reads the same env file. Prints `Feature "blog": applied 1 migration:` and the migration tag
$C run --rm --no-deps migrate
# 3. Start the API with the new env file
$C up -d --no-deps --force-recreate --wait api
```

- Order: migrate, then the API. An API started with a feature in `FEATURES_ENABLED` whose migrations are missing refuses to start and
  names the feature and the missing tags (loud, by design); run step 2 and start it again. With the deploy workflow, editing the env file
  and deploying the next release is enough: `migrate` runs before every API start.
- The storefront shows the feature's pages and links within 60 s (its config cache), without a restart; the admin shows its screens on
  its next read of the config (a page load).
- Switching off: remove the name and run step 3. The routes answer `404` at once, the storefront's pages within 60 s. The tables and
  their rows stay (switching on again brings them back); nothing is migrated.
- Removing a feature and its data (the `.down.sql` drops the feature's tables and every row in them: blog posts are gone): switch it off, back up, then run the feature's `.down.sql` files from the newest, BEFORE any core
  down migration (a feature table may reference a core table, `blog_post` references `media_upload`; core never references a feature
  table). From the API image, so a host with only `infra/` can do it:
  `$C run --rm --no-deps -T api cat /app/packages/features/blog/drizzle/0000_blog_post.down.sql | $C exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1`.
  The feature's folders then leave the fork (its README, "Removing the feature") and the next images are built without it.
- Checked by `scripts/deploy-smoke.sh` (section "Smoke test"); not yet done on a real host.

## TLS

The nginx edge reads `fullchain.pem` and `privkey.pem` from `FLUXKIT_CERTS_DIR` (mounted read-only; the files must be readable by uid 101). It does not obtain certificates itself. Options:
- certbot on the host with the webroot of the `acme-webroot` volume (port 80 serves `/.well-known/acme-challenge/` from it): `certbot certonly --webroot -w "$(docker volume inspect -f '{{.Mountpoint}}' fluxkit_acme-webroot)" -d shop.example.com`, then copy or link the files into `FLUXKIT_CERTS_DIR`. After each renewal: `docker compose ... exec edge nginx -s reload`.
- A DNS-01 client, or a load balancer that terminates TLS (then it is a proxy hop: see `TRUST_PROXY`).
- Or the Caddy edge (below), which obtains and renews certificates itself.

The edge offers TLS 1.2 and 1.3, sends `Strict-Transport-Security: max-age=31536000` on every https answer (one header: the storefront's own copy is removed), no `includeSubDomains` or `preload` (decide that for the whole domain first), and redirects port 80 to `https://<FLUXKIT_DOMAIN>` (never to a client-supplied host).

## The edge proxy (nginx)

- Replicas: API round robin, storefront `hash $request_uri`, so one URL is served by one replica and its per-process caches (ADR 0040/0051); not `consistent`, which with `resolve` does not pin (ADR 0057), with `zone`, `resolve` and `keepalive` on nginx 1.29.8. Both upstreams set `keepalive_time 10s`: nginx closes a connection after the request crossing 10 s, so sustained short requests do not keep a retiring Next replica busy until the 30 s stop grace expires. The API additionally answers `Connection: close` while draining; long requests can still exceed the grace. Both paths connect within 2 s and allow two upstream attempts on connection errors/timeouts. One refused connection marks that address down for 20 s (`max_fails=1`, `fail_timeout=20s`). `non_idempotent` is not enabled: nginx never replays a non-idempotent request already sent to an upstream.
- Routes: `^/(store|media)(/|$)`, `^/admin(/|$)` and `^/webhooks/payments(/|$)` / `^/webhooks/email(/|$)` to the API; `^/admin-ui/assets/` and `^/admin-ui(/|$)` from the files with the `index.html` fallback; everything else to the storefront. Upstreams are re-resolved every 10 s through Docker's resolver, so a recreated container is found without restarting the edge (smoke-tested).
- Request bodies: 1 MB by default (the API's own JSON limit is 100 KB); `/admin` 12 MB and streamed to the API (`proxy_request_buffering off`; keep it above `MEDIA_MAX_BYTES`); `/webhooks/payments` and `/webhooks/email` 64 KiB, the API's limit, buffered, forwarded byte for byte (the signature is checked over the raw body, ADR 0032).
- `/media/*`: no cache rule and no header of the edge's own; the API sends `Cache-Control` (immutable for a file, `no-store` for a 404). If you put a CDN in front, let it follow those headers.
- `/admin-ui`: the headers of `apps/admin/security-headers.ts` (copied; `apps/admin/edge-proxy-headers.spec.ts` fails when they drift), including `style-src-attr 'unsafe-inline'`, plus HSTS; `no-cache` on the HTML, `immutable` on existing hashed assets only (a missing asset is a plain 404).
- `X-Powered-By` of Express and Next is removed. `server_tokens off`.
- Client addresses: the edge sets `X-Forwarded-For` to the address it saw (`$remote_addr`), replacing any value the client sent, and the API trusts one hop (`TRUST_PROXY=1`). The smoke test checks both directions: an invented `X-Forwarded-For` does not open a new window, and a second client address keeps its own. The rule (with `Host` and `X-Forwarded-Proto`) lives in `snippets/forwarded-headers.conf`, included by `proxy-to-api.conf` and by the storefront location alike: the storefront passes the header on to the API for the search window (`STOREFRONT_FORWARD_CLIENT_ADDRESS`, ADR 0038), so the two paths must never differ. `apps/api/src/payments/webhook/edge-proxy-config.spec.ts` fails when a location sets the header itself or a second rule appears. Checked with the pinned nginx image (search UI review fixes): `nginx -t` passes, and an invented `X-Forwarded-For` reaches the API and the storefront upstreams replaced by the client's address; with the snippet switched to `$proxy_add_x_forwarded_for` both receive the appended chain.
- **IPv6 caveat (not verified here):** Docker forwards published ports to an IPv4-only bridge network through `docker-proxy` for IPv6 clients, so nginx sees the gateway address for all of them and they share one rate-limit window. Remedies: enable IPv6 on the Docker network (`enable_ipv6` with an IPv6 subnet) or run the edge with `network_mode: host` (then point it at the API and storefront by published loopback ports). Loopback traffic from the host also arrives from the gateway address (seen in the smoke test).
- The start-up script `16-fluxkit-env.envsh` refuses a missing or malformed `FLUXKIT_DOMAIN`, a malformed upstream, or an image host that is not a bare lower-case host name (the rule of `security-headers.ts`); the container then stops instead of serving a wrong policy.

### Caddy alternative

The replica configuration uses `dynamic a` (IPv4, DNS refresh 1 s) for both services, `lb_policy round_robin` for the storefront (not `uri_hash`: Caddy keeps no failure state for dynamic upstreams between retries, so a hash would retry the same draining or not yet ready replica while it is still in DNS; round robin moves on, at the cost of URL pinning, which only the nginx edge gives) and bounded retries (5 s, interval 250 ms, dial timeout 2 s). After a connection succeeds, only GET/HEAD may retry; a dial failure can retry any method. Caddy 2.10 does not retain passive failure state across dynamic-upstream retry iterations, so `fail_duration` is omitted. The 5 s retry window spans DNS refreshes, allowing a retired address to leave the pool; before refresh, the same address can be selected again. The old `FLUXKIT_API_UPSTREAM` / `FLUXKIT_STOREFRONT_UPSTREAM` host:port variables are replaced by `FLUXKIT_API_HOST` (default `api`), `FLUXKIT_API_PORT` (`3000`), `FLUXKIT_STOREFRONT_HOST` (`storefront`), `FLUXKIT_STOREFRONT_PORT` (`3001`): split any existing override when upgrading. The domain, admin site and image-source variables are unchanged. The revised file passes `caddy validate` (caddy:2.10-alpine), and was not run against the real API and storefront.

`infra/proxy/caddy/Caddyfile`: the same routes and headers, automatic HTTPS. Run the official `caddy:2.10-alpine` image with ports 80 and 443, the file at `/etc/caddy/Caddyfile`, a volume for `/data` (certificates), `apps/admin/dist` at `/srv/fluxkit/site/admin-ui` (build it with `pnpm --filter @fluxkit/admin build`, or copy it out of the edge image from `/srv/fluxkit/site/admin-ui`), and `FLUXKIT_DOMAIN`, `FLUXKIT_ADMIN_IMG_SRC` (written by hand: `" https://<host>"` per image host) in its environment. It is not wired into the Compose example and was not run with the real API or storefront (see the table above). Caddy replaces a client's `X-Forwarded-For` for the API and the storefront alike (`trusted_proxies` is a server option, so a CDN set-up changes both paths at once); do not configure it for the single-edge set-up. A missing hashed asset is a 404 without the immutable header (checked with the `file` matcher).

## Database roles

The example connects the `migrate` and `api` containers as `POSTGRES_USER`, the role that owns every table. Recommended for a live shop: keep that owner role for migrations only and run the API (and `run-once`, `admin:create`, `admin:unlock`) as a second role that owns nothing (privacy plan risk R11).

- Why: the append-only audit log and journals (`admin_audit_event`, `stock_movement`, `order_item`, `order_adjustment`, `order_status_change`, `order_shipping`, `shipment_status_change`, `payment_event`) are guarded by triggers. Migration `0011` added a `BEFORE TRUNCATE` trigger to each, so `TRUNCATE` (also through `CASCADE`) is refused for every role. A table OWNER can still `ALTER TABLE ... DISABLE TRIGGER` or `DROP TABLE`, and a superuser can do anything; a role without ownership cannot.
- Migrations run as the owner role (the `migrate` container keeps `DATABASE_URL` with `POSTGRES_USER`). A migration that adds a table gets the grants below automatically through the default privileges.
- The API needs only `SELECT, INSERT, UPDATE, DELETE` on the tables and `USAGE, SELECT` on the sequences. Foreign key actions (`SET NULL`, `CASCADE`) run with the table owner's rights, so the application role needs nothing extra for them.

Create the role once, as the owner role, after the first `migrate` run (`docker compose ... exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1`); replace `<owner>` with `POSTGRES_USER` and choose the password with `openssl rand -hex 32`:

```sql
CREATE ROLE fluxkit_app LOGIN PASSWORD '<hex password>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT CONNECT ON DATABASE "<POSTGRES_DB>" TO fluxkit_app;
GRANT USAGE ON SCHEMA public TO fluxkit_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fluxkit_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fluxkit_app;
-- Tables and sequences of later migrations (created by the owner role) get the same rights.
ALTER DEFAULT PRIVILEGES FOR ROLE <owner> IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fluxkit_app;
ALTER DEFAULT PRIVILEGES FOR ROLE <owner> IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO fluxkit_app;
-- Never TRUNCATE, TRIGGER or REFERENCES for the application (the GRANT above gives none of them; this documents it).
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM fluxkit_app;
```

Optional hardening of the journals (the application never updates them, and deletes only audit events older than 365 days in job 12; a client statement is refused by the triggers anyway): `REVOKE UPDATE, DELETE ON stock_movement, order_item, order_adjustment, order_status_change, order_shipping, shipment_status_change, payment_event FROM fluxkit_app; REVOKE UPDATE ON admin_audit_event FROM fluxkit_app;`. Not run against the full test suite: check it in staging before production.

Then give the `api` container its own `DATABASE_URL` with `fluxkit_app` (an override of the `api` service's `environment` in `infra/docker-compose.prod.yml`), keep `POSTGRES_PASSWORD` for `postgres` and `migrate` only, and keep the owner password out of the API's environment. The example Compose file does not do this split yet: it is a manual step.

What was checked (2026-10-30, a scratch database migrated to `0011`, PostgreSQL 16, the grants above plus the optional hardening): the role reads and writes the shop tables, uses the search sequence, inserts an audit event, writes into a table created later by the owner (default privileges), and deleting an admin user still sets `admin_audit_event.admin_user_id` to NULL; it is refused `TRUNCATE` (journal and mutable table), `ALTER TABLE ... DISABLE TRIGGER`, `DROP TABLE`, `UPDATE` of an audit event, `CREATE TABLE` and `SET session_replication_role`. The API, the jobs and the e2e suites were not run under this role.

## Updates and migrations

1. Back up (next section). Migrations are forward only; a rollback is manual.
2. `git pull` (or new image tags), then `docker compose ... build` and `docker compose ... up -d --wait`. With the deploy workflow this step and the backup are automatic (next section).
3. A plain `compose up` recreates changed containers and can interrupt traffic. For rolling replacement use the installed host script (next section): it waits for healthy Postgres, Meilisearch and Redis, runs `migrate` with a 600 s timeout, rolls API then storefront, and finally starts the edge/rest. Additive migrations must keep the serving old code working while they run. Email routing-state cutovers are an exception: stop every sender (all API replicas included) first, as described under "Ordered email fallback and usage".
4. A failed or timed-out migrate fails the release before API replacement. On timeout (Linux coreutils `timeout`, SIGKILL escalation after another 10 s), the script kills/removes the migrate container, tolerating cleanup errors; Postgres rolls back the interrupted transaction. A non-transactional migration file needs the backup. A replacement that never becomes healthy fails the release; new containers are removed newest stage first, with DNS refresh waits between removals, while old replicas keep serving. The script restores the env file and `current`; rollback recomputes the previous release digest from its release directory and the byte-identical restored `.pre-deploy` env file, so matching old replicas are kept. Services already replaced earlier in the release roll back with healthy previous-version replacements. A migration is never undone automatically: incompatible schema changes can prevent rollback and require the backup.
5. Rollback: stop the API, run the newest `apps/api/drizzle/NNNN_name.down.sql` against the database (`docker compose ... exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 < apps/api/drizzle/NNNN_name.down.sql`), one migration at a time from the newest, then start the previous image tag. The migrator refuses to run code older than the database. An enabled feature's migrations roll back first, before any core one (section "Optional features").
6. Old images stay on the host after an update (each release built there adds about 1.5 GB of images plus build cache). Keep the running tag and the previous one for rollback, remove older `fluxkit-*` tags (section "Disk space").

## Automatic deployment (GitHub Actions and Docker Hub)

`.github/workflows/deploy.yml` (plan `docs/plans/2026-11-12-deploy-workflow.md`) deploys every commit on `main` whose `CI` run passed,
and any commit on `main` by hand (Actions -> Deploy -> Run workflow). It is skipped while the repository variable `DEPLOY_HOST` is empty.

1. **Images** (GitHub runner, `linux/amd64`): the `api`, `storefront` and `edge` targets, pushed as
   `<DOCKERHUB_USERNAME>/fluxkit-{api,storefront,edge}:<first 7 characters of the commit>`. The host builds nothing.
2. **Host**: `git archive <commit> infra` goes over SSH to `infra/deploy/fluxkit-deploy`, which locks, unpacks the files into
   `/opt/fluxkit/releases/<tag>`, pulls every image (a missing one changes nothing), runs the backup command, writes the tag into
   `FLUXKIT_IMAGE_TAG`, points `/opt/fluxkit/current` at the release, starts infrastructure and waits up to 600 s for `migrate` to exit 0. It then
   rolls API and storefront in order: remove non-running service containers, compare release digests/counts, stage N replacements next to the old replicas one at a time,
   requiring the expected release-digest label and waiting for health after each addition (up to 5 minutes), then drain/stop/remove old replicas individually. The API and storefront images stay in Docker DNS for 5 s after the process stops accepting (`FLUXKIT_STOP_LINGER_SECONDS`, `infra/docker/stop-linger.sh`; the migrator does not), so nginx can refuse that address, retry a live replica and mark it down before the address leaves DNS and nginx rebuilds the peer list. Docker DNS
   publishes unready containers too: staging avoids two unready addresses defeating the edge's two attempts. DNS refresh waits before retiring and between
   retirements keep at most one stale address at the edge. Matching services are skipped. Finally `up -d --wait --no-build`
   reconciles the edge and remaining services; Compose restarts the exited migrate container (nothing pending). On failure it restores the env file and `current` and rolls back as above. That return
   cannot undo a migration (the old API refuses a newer database): then restore the backup ("Updates and migrations").
3. **Check**: `GET /store/config` and `GET /` through `DEPLOY_PUBLIC_URL`.

The deploy script exports `FLUXKIT_RELEASE_DIGEST` for every Compose call and labels API/storefront with `com.fluxkit.release-digest`. It hashes the ordered SHA-256 content hashes of that release's Compose file, the production env and the Meilisearch env (paths excluded, contents never logged). This avoids `compose config --hash`, which resolves `env_file` differently from `up` in newer Compose versions. Manual Compose leaves the label empty; the next deploy rolls those containers. New containers with a different label fail staging and are removed while old replicas stay.

Duration budget: infrastructure and final `up` each allow 300 s, migrations 600 s (plus up to 10 s escalation), and each new API/storefront replica another 300 s. With `A` API and `S` storefront replicas, the capped waits total `1200 + 300 × (A + S)` seconds per attempt: 30 minutes for 1 + 1 replicas, 40 minutes for 2 + 2. Add 11 s DNS discovery per rolled service, up to 30 s drain plus 11 s DNS wait per removed replica, command overhead and any failed-stage cleanup. A rollback can repeat the attempt: about 64 minutes for 1 + 1 including drain/DNS allowances, or 87 minutes for 2 + 2, before command overhead. Pulls/backups have separate host-dependent durations. The deploy job allows 60 minutes; near-limit waits or higher replica counts can exceed that runner budget, so it is not a guarantee that rollback finishes within it.

Set up once:

| Where | Name | Value |
|---|---|---|
| Repository variable | `DOCKERHUB_USERNAME` | Docker Hub account or organisation |
| Repository secret | `DOCKERHUB_TOKEN` | Docker Hub access token, read and write |
| Repository variable | `DEPLOY_HOST`, optional `DEPLOY_USER` (root), `DEPLOY_PORT` (22) | The host |
| Repository variable | `DEPLOY_KNOWN_HOSTS` | `ssh-keyscan -t ed25519 <host>` output (port other than 22: `[host]:port`); checked strictly |
| Repository secret | `DEPLOY_SSH_KEY` | Private half of a key made only for this (`ssh-keygen -t ed25519 -N '' -C fluxkit-deploy`) |
| Repository variable | `DEPLOY_PUBLIC_URL` | `https://<domain>`, checked after the deployment |
| Repository variable | `STOREFRONT_IMAGE_HOSTS`, `STOREFRONT_REQUIRE_LEGAL_TEXT` | Storefront build arguments (Configuration, TLS) |
| Host | `/usr/local/sbin/fluxkit-deploy` | `install -m 0755 infra/deploy/fluxkit-deploy /usr/local/sbin/` (update it by hand when the file changes) |
| Host | `~/.ssh/authorized_keys` of `DEPLOY_USER` | `command="/usr/local/sbin/fluxkit-deploy",restrict <public key> fluxkit-deploy`: the key can run nothing else |
| Host | `FLUXKIT_IMAGE_PREFIX` in the env file | `<DOCKERHUB_USERNAME>/fluxkit`; `FLUXKIT_IMAGE_TAG` present (the running tag) |

The script's paths are the test server's layout and can be changed with variables at its top (`FLUXKIT_ROOT`, the env files, the
backup and image cleanup commands; it runs them when they exist). The deploy user needs Docker (root, or the `docker` group,
which is root-equivalent), and Linux tools `flock`, GNU `sed`, `sha256sum` and coreutils `timeout`.

Notes:
- Docker Hub creates a repository as **public** on the first push unless the account's default is private. This repository is
  public; a client fork should make the three image repositories private (or use another registry and change the login step).
- Whoever can push to `main` or holds the Docker Hub token can run code on the host. Protect `main` and keep the token's scope to
  these repositories where Docker Hub allows it.
- **Reinstall the host script once after this change:** `install -m 0755 infra/deploy/fluxkit-deploy /usr/local/sbin/fluxkit-deploy`. Its installed copy is outside the release archive and is not updated automatically; the old copy still deploys with downtime. Then set the replica counts after checking host memory.
- HTTP drains before Nest lifecycle hooks close the scheduler, database and Redis, for SIGTERM and `createApp` callers using `app.close()`; while draining every answer carries `Connection: close`, so the edge's keep-alive connections end and it moves to another replica. API/storefront get 30 s stop grace; requests exceeding that can be killed. Server-side API GET/HEAD reads retry one connection failure before an answer (refused/reset/unreachable/socket closed), sharing the original abort/timeout budget. The retry is best-effort: a second direct DNS lookup can still select the same unavailable API address. Writes, HTTP statuses, timeouts and aborts are never retried by the storefront wrapper.
- The edge is still **one container** and its tag changes each release. Recreating it leaves a brief gap (connections refused or TLS handshakes cut off for a few seconds; no HTTP request reaches the shop in that gap); this is not uninterrupted edge availability. A second edge/host load balancer is a later step. Infrastructure recreation can also interrupt service; rolling application replacement does not make database or Redis upgrades highly available.
- `FLUXKIT_DEPLOY_SKIP_PULL=1` is **test-only**, for the smoke test against local image tags. Never set it on a deploy host.

## Backups

- **Postgres**: `docker compose ... exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > fluxkit-$(date +%F).dump` (daily, kept off the host). Restore into an empty database with `pg_restore`.
- **Media volume** (`MEDIA_DIR`): back it up AFTER the database dump (files are only added; README "Uploaded images" explains why this order is safe): `docker run --rm -v fluxkit_media:/m:ro -v "$PWD":/b alpine tar -C /m -czf /b/media-$(date +%F).tgz .`
- **Search index**: no backup needed. It is rebuilt from Postgres (see "Catalog search"); after a database restore run the reindex command.
- **Secrets**: `infra/production.env` (at least `ORDER_TOKEN_SECRET`) belongs with the backups, encrypted. `SECRETS_ENCRYPTION_KEY` is kept apart from the database dump ("Integration credentials" below): a dump and this key together are the provider keys in the clear.
- A restore has never been tested in this repository: test one before going live.

## Integration credentials (ADR 0058)

The owner can enter provider keys in the admin (Settings, Integrations). They are stored in Postgres, encrypted with `SECRETS_ENCRYPTION_KEY`. In this release a stored key is only kept: providers still read their keys from `production.env`, and a variable set there always wins.

- **Switching it on:** add `SECRETS_ENCRYPTION_KEY=<key-id>:<base64>` to `production.env` (`openssl rand -base64 32` for the value; any short id such as `2026a`), then recreate the API containers. Every API replica needs the same value. Redis must be reachable: each change is rate limited there and is refused (`503`) when it is not.
- **Who keeps the key:** whoever deploys the shop (our team or the client). Store a copy outside the host and apart from the database backups, with the same care as a password manager entry. Never put it into an image, a repository or a ticket.
- **Losing it:** catalog, orders and customers remain in Postgres, but stored credentials and the permanent merchant baseline become unreadable. Recover the original encryption key from its separate backup before re-saving or activating Monobank credentials. Re-entering provider credentials cannot recover payment-bound versions or the merchant baseline, so historical refunds/reconciliation and merchant enrollment/activation may remain unavailable. Do not delete the baseline or rebind payments; without key recovery, an owner-approved recovery/migration procedure is required and is not provided in this release.
- **Restore drill:** recover every encryption key required by retained versions and the merchant baseline in the dump, including keys older than the key current at backup time. Install the required current/previous pair on every replica and verify historical payment access and baseline decryption after restore. A dump that needs more than the two supported key-ring slots requires a separately approved recovery procedure; re-saving is not a repair.
- **Rotation (manual for now):** install the new key as `SECRETS_ENCRYPTION_KEY` and keep the old key as `SECRETS_ENCRYPTION_KEY_PREVIOUS` on every replica, then recreate the API. Re-saving creates new credential versions; it does not re-encrypt retained payment-bound versions or the immutable merchant baseline. Keep `SECRETS_ENCRYPTION_KEY_PREVIOUS` installed while either needs it. The slice 3 rewrap command, including baseline rewrap, is not built; re-saving alone is insufficient to remove a key. Retain every key that sealed a retained version or baseline, and keep backup keys separately for as long as their backups remain. The runtime key ring has only two slots: do not rotate again while retained data needs both installed keys; wait for verified rewrap support.
- **A leaked key or dump:** revoke the provider keys at the providers; deleting the stored copy does not revoke them.
- Not verified on a real host yet.

## Logs

- Every container logs to stdout/stderr; the Compose file rotates them (`json-file`, 5 files of 20 MB per container). Read them with `docker compose ... logs -f api`.
- The API logs errors and job summaries, never passwords, tokens, payment bodies or mail contents (ADR 0031, 0032). nginx access logs contain client IP addresses and URLs (personal data under GDPR): keep the rotation short or ship them to a store with a retention policy. Guest order links keep their token in the URL fragment, which never reaches the server.
- No metrics or tracing exist. Watch: container health (`docker compose ps`), `migrate` exit codes, `503` from `/media` uploads (disk full), free disk space of the media and Postgres volumes.

## Disk space

The Compose file limits container logs only. Nothing else in the example frees space by itself:

- **Images**: every release built or pulled on the host stays until removed. Keep the running `FLUXKIT_IMAGE_TAG` and the previous one (rollback); remove older `fluxkit-api|storefront|edge` tags with `docker image rm`. Never remove an image a container still uses, and never run `docker image prune -a` or `docker system prune` on a shared host: they also remove other projects' images.
- **Build cache**: building on the host leaves several GB of cache. `docker builder prune --force --filter until=168h` drops what was not used for a week (the cache is shared by every build on the host).
- **Backups** on the host grow with the database and media; keep a fixed number of days and copy them off the host.
- **Watch free space**: a full disk stops uploads (`503` from `/media`) and, worse, Postgres. A simple scheduled check of `df` with a warning threshold (for example 5 GB) is enough on a small host; send the warning somewhere a person reads it.

The test server's scripts and timers for these points are described in `docs/plans/2026-11-10-hetzner-first-deploy.md`, section 15.

## Production readiness checklist

- [ ] Images built from a tagged commit; `pnpm lint`, `typecheck`, `test`, `check:licenses`, `audit:prod` green on that commit.
- [ ] `infra/production.env` filled, `chmod 600`, secrets generated as above, `NODE_ENV` not overridden.
- [ ] TLS certificate valid for the domain; renewal and the `nginx -s reload` hook in place.
- [ ] `TRUST_PROXY` equals the number of proxies in front of the API ("Proxy hops"); from two different networks a limited route is counted separately ("Checking per-address limits").
- [ ] Replica counts fit host memory (1 GB per API/storefront replica, plus rollout overlap); more than one API uses `RATE_LIMIT_STORE=redis`; the installed host script is current. Scheduler enabled under the shared Postgres lock (or a cron runs `run-once`).
- [ ] First owner created; `pnpm seed` NOT run; demo methods or products not present.
- [ ] The API runs as a database role that owns no table and has no `TRUNCATE` (Database roles); the owner role's password is not in the API's environment.
- [ ] `EMAIL_PROVIDER`, `EMAIL_FALLBACK_PROVIDERS`, `PAYMENT_PROVIDERS_ENABLED` and `SHIPPING_PROVIDERS_ENABLED` decided (the fakes are refused in production); for Monobank the webhook URL `https://<domain>/webhooks/payments/monobank` reachable from the internet.
- [ ] Every selected primary/fallback mail provider has a verified sender, its own send key, authenticated reachable subscription, reconciled historical blocks and reviewed processor terms; migrations `0017`/`0018` and the sender cutover are complete. A local startup check does not prove remote feedback works.
- [ ] `STOREFRONT_IMAGE_HOSTS` set before the storefront image was built; an uploaded image shows in the storefront (hairpin works).
- [ ] Backups of Postgres and the media volume scheduled and a restore tested.
- [ ] When the owner enters provider keys in the admin: `SECRETS_ENCRYPTION_KEY` set on every API replica and backed up apart from the database dumps ("Integration credentials").
- [ ] Search: `infra/meilisearch.env` written (master key generated), the scoped key made, `SEARCH_ENABLED=true`, `GET /store/config` says `search: true`, a product found after the index is built; the engine's port is not published.
- [ ] `FEATURES_ENABLED` decided; for each enabled feature the `migrate` log shows its migrations, `GET /store/config` lists it in `features` and its pages answer (section "Optional features").
- [ ] Swagger UI stays unrouted: `/docs` and `/docs-json` answer 404 through the edge (owner's decision 2026-11-14).
- [ ] Launch blockers in `docs/HANDOFF.md` reviewed (privacy plan before the EU launch). The catalog reads of `/store/*` are limited per address (`catalogRead`) only when `TRUST_PROXY` is right (above), the API is reachable only through the edge, and the storefront's `API_INTERNAL_URL` points at the API itself (the Compose value), not at the public edge.
- [ ] The Docker images' own licences reviewed before images are handed to a client (below).

## Smoke test

`bash scripts/deploy-smoke.sh` builds the three images, checks that every feature migration and its `.down.sql` are in the API image (the blog's among them), starts the Compose example (including the search engine: it creates the scoped key, switches search on and checks `/store/config` and `/store/search`; then it switches the blog on in the running stack as in "Optional features": `/uk/blog` and `/store/blog/*` are `404` before, the API refuses to start before the blog's migration, `migrate` applies it, and after the API restart the store route answers and the storefront, neither rebuilt nor restarted, renders `/uk/blog` with its link and lists it in `/sitemap.xml`, which shows the slice registry was generated in the Docker build) under the project name `fluxkit-smoke` on `127.0.0.1:18080` and `127.0.0.1:18443` with a throwaway env file and a self-signed certificate in `infra/.smoke/` (git-ignored), runs the checks and removes everything (`--keep` leaves the stack up). Needs Docker with Compose and BuildKit, `openssl`, `curl`, `jq`. Behind a TLS-intercepting proxy, pass a base image that trusts its CA: `SMOKE_BUILD_ARGS="--build-arg NODE_IMAGE=<your node image>"` (the `NODE_IMAGE` argument of the Dockerfile; that is how it ran in the agent sandbox).

`bash infra/deploy/fluxkit-deploy.spec.sh` checks sequential starts, newest-first failure cleanup/DNS waits, preserved old IDs, digest/count skips, stopped-container removal, wrong-digest rejection and migration timeout cleanup with in-memory Docker boundaries. Disposable digest fixtures verify all three inputs and byte-identical env restoration; no containers or real release files change.

The expanded PR 4 smoke checks run 2 API and 2 storefront replicas with Redis limits, assert one Redis admin-login key for the 20-then-429 window, check the uploaded file from both replicas, then run the real host script with local hex image tags and a throwaway host layout. During both successful and failed releases, a traffic loop counts successful API/storefront reads, cold missing-product 404s (unique paths force server API reads) and edge connection refusals, rejecting 5xx and other curl failures. A broken API image must fail release, preserve the prior API container IDs, and restore env/current. CI runs them on Linux (`deploy-smoke`; first green run 2026-11-16: a successful release of about 1 000 reads with no 5xx, the only failures being refused or cut connections within one edge restart, and a failed release with no failure at all). The host-script portion needs Linux tools (`flock`, GNU `sed`, `sha256sum`, coreutils `timeout`); the shell syntax stays Bash 3.2 compatible.

## Licences of the images

The images are external tooling, not linked code (AGENTS.md section 16): Node.js (MIT) on Debian bookworm-slim, nginx (BSD-2-Clause) on Alpine (the `nginxinc/nginx-unprivileged` image, Apache-2.0 packaging), PostgreSQL (PostgreSQL licence), Caddy (Apache-2.0). The base layers contain GPL and LGPL system packages (for example bash, coreutils and glibc in Debian, BusyBox in Alpine). Running them is fine; **handing built images to a client is a distribution** of those packages, which brings source-offer duties. That decision is the owner's and legal's (`docs/dependencies.md`); until then deliver the repository and let the client build.


## Shared rate limits

- Deploy the new API with `RATE_LIMIT_STORE=memory` first (the default, one API instance). To switch to shared windows, supply `REDIS_URL` for a reachable private Redis service, including its password, then set `RATE_LIMIT_STORE=redis` in the API environment and recreate the API. The production example runs a private `redis` service (password `REDIS_PASSWORD`); its URL is `redis://:<REDIS_PASSWORD>@redis:6379`. Do not expose Redis to browsers or the public internet.
- All API instances of a shop use the same database name, Redis URL and `ORDER_TOKEN_SECRET`. Each database name has a separate Redis namespace; changing the database name or `ORDER_TOKEN_SECRET` starts fresh counters (the old keys expire with their window, at most 24 hours); switching to `memory` and back to `redis` within a window resumes the counts still in Redis. Roll back with `RATE_LIMIT_STORE=memory` and recreate the API.
- Redis must answer at startup or startup fails. At runtime an outage falls back to bounded per-process windows and logs `rate_limit_store_unavailable` at most once a minute per API. Limits can then be multiplied by the number of instances; `GET /health` stays 200 if Postgres answers and reports `rateLimitStore: "degraded"`. A successful Redis hit restores `redis`; memory mode reports `memory`.
- Shared through the store: the named request windows, the per-email and per-customer service windows, the admin and customer login throttles and the email pacer. API replicas share the one-host media volume; storefront caches still belong to each process (edge URL hashing, ADR 0057).
- Shipping carrier caches/concurrency gates, payment read single-flight, the search interactive lane and its diagnostic counters remain per API instance. Budget media processing memory per replica (512 MB minimum); scaling multiplies these caps and memory needs.

### Shared email pacing

With `RATE_LIMIT_STORE=redis`, job 9 and immediate mail attempts reserve slots on one Redis clock at the configured provider rate (default 8/s), plus a 6 ms guard (5 ms of allowed lateness and 1 ms of Redis clock rounding). Stale slots are reacquired; missed slots never cause catch-up sends. Every actual provider start also advances a process-local schedule, preserved through Redis failure and recovery. The `fluxkit:{prefix}:email-pacer` key contains only the next slot timestamp and expires after queued slots pass (minimum one second). Errors use the same throttled store log and `rateLimitStore` degradation/recovery as request windows; during a Redis outage the combined rate across processes can exceed the provider cap. Provider-chain fallback uses this same conservative shared 8/s pacer; it does not create a separate allowance per provider. Durable cooldowns remain in PostgreSQL during Redis loss.

The safety margin trades throughput for spacing: measurements at a configured 8/s give about 94.7% of the rate at 1 ms Redis RTT (the slot lateness tolerance costs about 5%), 7.30/s at 6 ms, 6.62/s at 20 ms and 5.52/s at 50 ms. Redis RTT lowers throughput, never raises it above the configured rate while shared pacing is active. Keep Redis on the same host or a low-latency network.

Admission waits are bounded by the earlier of the mail's deadline and lease expiry minus the provider timeout and a 5-second margin. A refused slot returns the claim to the outbox without spending an attempt, rescheduled one second later (capped at the deadline). Lease time guarantees ownership while waiting; time is checked immediately before the provider call, with no admission database read. Guarded recording/deferral detects a newer claim. Shared reservations pad spacing for observed Redis reply time separately from the 5 ms timer allowance: increased reply latency or a stale timer reacquires within the remaining budget. Steady Redis latency continues sending conservatively below the configured maximum; repeated lateness can defer sends. Monitor outbox age as well as provider throughput. Memory mode keeps single-process pacing with the same lease/deadline protections. The 50-waiter immediate cap remains per process. Use the replica/rollout setup above when scaling. See ADR 0055 and ADR 0057.

## Brevo email (ADR 0056 step 1)

Select `EMAIL_PROVIDER=brevo` and provide `BREVO_API_KEY`, the verified `EMAIL_FROM` and `STOREFRONT_PUBLIC_URL` through the runtime env file (the production Compose API uses `env_file`; no key is baked into images). See [plugin setup and live checks](../packages/providers/brevo/README.md). Brevo Free adds "Sent with Brevo" to every mail; removing it requires a paid Brevo plan. Accepted overflow can queue and arrive after Fluxkit's deadline.

Stop all old mail senders before migration 0016/backfill and start only the new version afterwards. Open attempted rows without `provider_code` require operator reconciliation first. Preserve pins on config changes; missing pinned providers hold until deadline, then `unknown`. Brevo ambiguity currently ends `unknown` immediately because inline deduplication is not live-verified. Manual resend can duplicate earlier mail. Down migration refuses active pins or new-format IDs; do not delete evidence to force a rollback. Step 1 introduced the single-provider pin prerequisites; suppression and ordered fallback are the subsequent sections. Owner live-send, DPA and production cutover checks remain pending.

## Email suppression webhooks (ADR 0056 step 1b)

Email-only upstream 502/503/504 responses and connection/timeout errors become `429` with `Retry-After: 5` in nginx and Caddy. Payment and other upstream statuses keep their existing behaviour. Ingestion bounds PostgreSQL advisory waits to 2 seconds and individual statements to 5 seconds; application/guard/raw-reader failures use the same retryable problem response. Confirm both proxy paths during rollout; static config tests do not establish runtime delivery.

1. Apply migration `0017_email_suppression` before starting new senders/ingress. Step 1b introduced the local suppression prerequisite; configure every service selected as primary or fallback before enabling the chain. A blank webhook secret disables ingestion (404) while the local sender guard remains active. Startup validates nonblank plugin secrets; it cannot prove a remote subscription, matching secret, reachable route or historical completeness.
2. Resend: set `RESEND_WEBHOOK_SECRET` to the endpoint's `whsec_` signing secret and configure HTTPS `POST /webhooks/email/resend`; subscribe to `email.bounced`, `email.complained`, `email.suppressed`, `suppression.added`. Only Permanent bounces suppress. Svix sends `svix-id`, `svix-timestamp`, `svix-signature`; verification uses exact bytes before JSON parsing. `suppression.removed` never clears a local block.
3. Brevo: generate a separate high-entropy URL-safe bearer token (at least 43 characters) as `BREVO_WEBHOOK_SECRET`; configure HTTPS `POST /webhooks/email/brevo` with `auth: {type: "bearer", token}` and transactional subscriptions `hardBounce`, `spam`, `unsubscribed`, `blocked`. Payload event spelling `hard_bounce` is distinct from the subscription spelling. Do not use URL credentials or the send API key. No body signature exists; a leaked token can forge timestamps/payloads.
4. Optionally restrict the webhook paths at the edge to current provider-published source CIDRs. Maintain the ranges from official documentation and trusted-proxy configuration; no hardcoded IP policy ships in the app. Keep auth enabled behind an allowlist. Preserve raw request bytes and allow at most 64 KiB. Both shipped edges explicitly forward `/webhooks/email` and its subpaths to the API with a 64-KiB limit, separately from payment routes.
5. Reconcile historical remote blocks before relying on local suppression, before fallback activation. Late events beyond seven days are rejected with a code-only warning and need operator reconciliation. A transient local error returns 429/Retry-After so the provider retries; a 204 means committed/duplicate/irrelevant. Monitor code-only failure logs and database availability.
6. The Email → Suppressions view permits authorized removal with confirmation and atomic audit. Review the reason first; removing locally neither removes the provider's block nor automatically resends. Receipts stay for eight days to reject duplicate replays. Feedback arriving after pacing admission cannot recall an already admitted send. Auth mail is also blocked; use authorized review for recovery.

TODO(fluxkit): not live-verified — Resend subscriptions/event shapes and retry delivery; Brevo exact `Authorization: Bearer <token>` emission, single-object vs batched payloads, event shapes/timestamps, tuple stability across retries, subscriptions/retry behaviour; matching secrets/reachability and initial reconciliation of historical blocks. These require owner-controlled events and authorization; stub tests do not close them. Both provider READMEs list setup and pending checks. Suppression/receipts contain personal data; follow the privacy erasure guide and legal retention open item. Down migration refuses nonempty suppression/receipt tables and retained suppression audit rows; never delete them merely to permit rollback.

## Ordered email fallback and usage (ADR 0056 step 2)

- Set `EMAIL_PROVIDER` to the primary and `EMAIL_FALLBACK_PROVIDERS` to ordered comma-separated fallback codes. Codes are trimmed/lowercased; unknown/`none`/empty entries, duplicates, primary repetition, or fallbacks with primary `none` fail startup. All selected package keys are required. Production refuses test-only providers at every position; no API key or account identity is returned by status/export.
- A nonempty chain refuses startup unless migration `0017_email_suppression` is recorded, suppression/receipt columns are queryable with SELECT/INSERT/UPDATE/DELETE privileges, the shared sender guard is wired, and every selected provider (primary included) has a valid authenticated webhook verifier/secret and registered route. Empty tables are valid. No bypass, migration application or provider call occurs at startup. Confirm remote subscriptions, edge reachability, matching secrets and historical blocks separately; the local gate cannot establish these.
- Cutover: back up, stop **all** API instances/immediate senders, scheduler workers and `run-once` processes, then apply migrations through `0018_email_provider_routing` and start only the new version. Stop serving auth/test/resend actions too; turning the scheduler off alone is insufficient. Migration 0018 adds `route_provider_code`, shared `email_provider_state` and the partial accepted-send index. Preserve migration 0016 pins/backfill. Never overlap legacy and routing-aware senders; this is a brief quiescent cutover, not an automatic zero-downtime rollout. Production activation and cutover still require the owner's authorization.
- Only an unpinned, proven-unsent `quota_exceeded`, `rate_limited`, `misconfigured` or `not_sent` can advance. `rejected` and shared suppression never advance. A timeout, unavailable/malformed response or unresolved lease pins the same provider and UUID permanently; later quota refusal cannot unpin it. Brevo remains `idempotencyKeys=false`: ambiguity stops `unknown` without replay. Acceptance into a remote queue is `sent`, with no fallback or timely-delivery guarantee.
- PostgreSQL atomically commits fenced outcome, pin, next route and cooldown outside HTTP. If the remaining budget cannot cover B after A's safe refusal, a deferred B route survives restart. An exhausted safe pass clears the route and waits for the earliest cooldown/backoff. Each provider is considered at most once per pass. A blocked/pinned message does not stop other mail; suppression is checked on every attempted provider. No DB operation occurs between final pacing admission and the call.
- Cooldowns are shared and only extend: Resend's proven daily quota uses the next 00:05 UTC; other/unknown quota and misconfiguration use an hourly recovery probe, without inventing a Brevo reset. Rate limits use validated server delay/backoff. Expiry grants one bounded DB-time recovery-probe lease across instances; only matching success clears it. Account/key changes or restarts do not reset cooldowns. PostgreSQL loss prevents an unfenced fallback send; the existing 8/s pacer still applies across the entire chain.
- Provider removal/reordering never changes an existing pin. Reconcile/drain pending routes and pins before removing a package/configuration; otherwise a missing pinned provider is held under `pinned_provider_unavailable`, then becomes `unknown` at expiry. Never clear a pin or assign a fresh UUID to work around it. Manual resend creates a new row/key and may duplicate earlier delivery. For rollback stop every sender: migration 0018 down refuses pending/sending rows with a deferred route, and removes only its exact journal entry. Older guarded downs still protect active pins/new-format IDs and suppression data/audit evidence. Do not delete or rewrite evidence to force a downgrade; disabling fallback preserves pins and shared suppression.

### Advisory usage meter

`GET /admin/email/status` and Email status show retained local accepted-send history for each ordered provider, **across all accounts** (`provider_all_accounts`, `lowerBound: true`). One server `usageAsOf` snapshot counts `status=sent` by actual `provider_code` and `sent_at < usageAsOf`: today is UTC midnight to the next UTC midnight; month is UTC first day to next month's first day. Admin tests/manual resends count; retries of one accepted row count once. Pending, sending, unknown and cancelled mail is excluded even if a remote acceptance was possible. Existing legacy status counts remain rolling 24-hour `updated_at` counts.

Optional `EMAIL_USAGE_LIMITS` sets server-only JSON caps; every explicit provider entry contains `daily` and `monthly` as positive safe integers or null. Defaults are Resend 100/day and 3,000/month, Brevo 300/day and null/month, other/test providers null/null. Null means no configured limit, not unlimited service. Values compare all-account retained history with the configured cap: warnings start at 80%/100%, actual counts can exceed the cap and only bars are clamped. Brevo's provider reset is unknown (`providerResetAt: null`); Resend's midnight reporting/reset is distinct from its 00:05 retry margin.

This is not delivery/billing data, a remaining balance, credit reservation or automatic routing input. Cleanup (including job 10's 30-day sent retention), erasure, unrecorded/ambiguous acceptance, other applications and account changes limit its meaning. Credential history/change time remain unknown/null; rotating a key does not reset provider-code history. Keep the permanent lower-bound/all-account/account-change warnings and existing privacy retention/erasure rules. Set limits on the server and restart when a plan changes; no admin credential/quota editor or account identity is introduced.

TODO(fluxkit): not live-verified — send/refusal and quota/reset semantics, exact Brevo inline deduplication, accepted remote queue timing, webhook delivery/reconciliation and full cutover/rollback on a real host. Owner/legal still review every primary/fallback processor's terms, DPA, entity, transfers and content/log retention; Brevo EU database hosting does not establish EU-only processing. Free branding removal requires a paid Brevo plan. Local fakes do not close these checks.

- Migration 0018 bounds transaction-local lock waits to 5 seconds and statements (including the index build) to 30 seconds. A busy or large outbox fails the migration atomically instead of waiting indefinitely. For a large outbox, arrange a separately reviewed concurrent-index rollout and quiescent schema cutover before enabling fallback; this generated small-outbox migration does not promise a nonblocking index build.

## Switching payment keys from env to the admin

1. Finish and reconcile env-bound payments for each provider, including outstanding refunds and invalidation work, while the original env keys remain available. Do not replace or remove a key that still serves historical work. Managed activation refuses open legacy work with `integration_legacy_work_open`; no helper imports or guesses bindings.
2. Back up PostgreSQL and the exact `SECRETS_ENCRYPTION_KEY` master key separately and securely (and its previous key while envelopes still require it). A database backup without the master key cannot recover credentials or the permanent merchant baseline.
3. Remove `PAYMENT_PROVIDERS_ENABLED` entirely and remove `MONOBANK_TOKEN` / `LIQPAY_PUBLIC_KEY` / `LIQPAY_PRIVATE_KEY` for providers moving to admin control. A present blank enablement variable keeps env mode off. Restart the API with the intended immutable environment.
4. Save complete credentials in Integrations. Monobank's first successful read locks the merchant permanently; checks perform no payment. LiqPay requires both fields and reports the optional online check as unsupported. Explicitly activate each desired provider and verify webhook reachability.
5. Rotation drains the prior stored version so refunds/reconciliation/webhooks can continue. Disable stops new admissions. Local revoke stops further calls/signing and preserves accounting bindings and baseline; revoke at the provider separately if needed. Previously delivered signed forms cannot be recalled. Shipping remains env-only.

Migration `0023_managed_payment_credentials` rollback refuses any bound payment or merchant baseline. Never clear retained bindings or baseline rows to force rollback. API DB access should use a non-owner application role, preserving trigger protections.
