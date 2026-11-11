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
| Smoke test | `scripts/deploy-smoke.sh` (CI job `deploy-smoke`) | Passes locally and in the CI job `deploy-smoke` on GitHub (green for the search engine change, 2026-11-04) |
| Header copies | `apps/admin/edge-proxy-headers.spec.ts` | Fails when the nginx copy of the `/admin-ui` headers drifts from `apps/admin/security-headers.ts` |
| `.env.example` completeness | `scripts/check-env-example.mjs` (`pnpm check:env`, CI `verify`) | Fails when the code reads a variable `.env.example` does not list |

Not verified anywhere: a certificate from a real CA, real DNS and public traffic, IPv6 clients, a payment provider calling the webhook, real mail, a restore from backup, an update of a running shop, more than one host.

## Topology

```
internet ──80/443──▶ edge (nginx, uid 101; TLS, routing, admin SPA files)
                       ├── /store, /admin, /media, /webhooks/payments ──▶ api:3000 (Node, uid 1000; also the scheduler)
                       ├── /admin-ui ──────────────────────────────────▶ files in the edge image (index.html fallback)
                       └── everything else ────────────────────────────▶ storefront:3001 (next start, uid 1000)
storefront ──API_INTERNAL_URL=http://api:3000──▶ api   (catalog reads of the Next server, no cookies)
migrate (api image, runs once per `up`) ──▶ postgres:5432 ◀── api
api ──MEILI_URL=http://meilisearch:7700──▶ meilisearch (Community Edition; no published port, not routed by the edge)
volumes: postgres-data, meili-data, media (MEDIA_DIR), acme-webroot
```

- Only the edge publishes ports. The API's `/docs`, `/docs-json` and `/health` are not routed (they answer the storefront's 404); the owner's decision on Swagger in production stays open, the default is "not public".
- **Meilisearch is part of the example** (catalog search, ADR 0034; image pinned to the version CI tests, `MEILI_ENV=production`). It is reachable only by the API on the Compose network; the browser never talks to it. `api` waits for it to be healthy even with search off, so a broken engine stops the boot instead of failing later. The index is rebuilt from Postgres, so `meili-data` is a cache, not a backup target.
- **Redis is not part of the example on purpose**: `REDIS_URL` is parsed but no running code uses Redis or BullMQ (only the spike specs; `grep` for `redisUrl`, `ioredis`, `bullmq` outside specs, 2026-11-04). It comes with the queue or shared rate-limit plan, and runs then under the approved AGPLv3 exception (`docs/dependencies.md`).
- **Run exactly one `api` container.** The rate limits, the login throttle, the shipping caches, the mail pacing and the local media disk are per process (ADR 0009, 0016, 0028; shipping step 6). Two instances double every limit and split the uploaded files. The scheduler (jobs 1 to 14, `docs/api/jobs.md`) runs inside that one API under a Postgres lock; there is no worker image. With `SCHEDULER_ENABLED=false` run `node dist/jobs/run-once.js` from a host cron (`docker compose ... run --rm api node dist/jobs/run-once.js`) instead.

## Prerequisites

- A Linux host with Docker Engine 25 or newer and Compose v2.20 or newer (`up --wait`), about 2 GB RAM free for the API (image uploads need about 512 MB of headroom, ADR 0028), 1 GB for the storefront, and disk for Postgres, the media volume and the images (`api` about 560 MB, `storefront` about 1 GB, `edge` about 85 MB, measured 2026-10-29).
- A DNS name for the shop pointing at the host, ports 80 and 443 open.
- A TLS certificate for that name (see TLS). The host must reach its own public address on 443 (hairpin): the Next image optimizer fetches uploaded images from `https://<domain>/media/...` from inside the storefront container and refuses private addresses (ADR 0028, README "Uploaded images").
- The repository checked out on the host (or images built elsewhere and pushed to a private registry: set `FLUXKIT_IMAGE_PREFIX` and `FLUXKIT_IMAGE_TAG`).

## Configuration

`cp infra/production.env.example infra/production.env`, fill it in, `chmod 600 infra/production.env`; likewise `cp infra/meilisearch.env.example infra/meilisearch.env` for the engine's master key (`FLUXKIT_MEILI_ENV_FILE` points elsewhere). The file is git-ignored. Compose reads it for the `${...}` values of `infra/docker-compose.prod.yml` (`--env-file`), and the `api` and `migrate` containers get all of it as their environment. The storefront and the edge get only their own variables. Nothing secret is built into an image.

Secrets (generate, store in a password manager, back up with the database where noted):

| Variable | Generate | Note |
|---|---|---|
| `POSTGRES_PASSWORD` | `openssl rand -hex 32` | Hex only: it is placed unescaped into `DATABASE_URL` by the Compose file |
| `MEILI_MASTER_KEY` | `openssl rand -hex 32` | At least 16 bytes. Not in `production.env`: it is in `infra/meilisearch.env` (template `infra/meilisearch.env.example`, `chmod 600`, git-ignored), read only by the engine container, so the API process never holds a key that can mint other keys. Used once to create the scoped key |
| `MEILI_API_KEY` | created once, see "Catalog search" | The scoped key the API uses; never the master key. Needed only with `SEARCH_ENABLED=true` |
| `ORDER_TOKEN_SECRET` | `openssl rand -base64 48` | At least 32 characters. Changing it breaks the links of unpaid guest orders and every emailed reset or verification link (ADR 0023, 0031): keep it with the database backup |
| `MONOBANK_TOKEN` | Monobank business cabinet | Only with `PAYMENT_PROVIDERS_ENABLED=monobank`; never logged |
| `RESEND_API_KEY` | Resend dashboard (sending-only key) | Only with `EMAIL_PROVIDER=resend` |
| `NOVA_POST_API_KEY` | Nova Post business cabinet | Only with `SHIPPING_PROVIDERS_ENABLED=nova_post` |
| `ADMIN_PASSWORD` | the owner's choice, 12 to 128 characters | Not in the file: given once to the create-admin command (below) |

Set by the Compose file (do not put them in the env file): `NODE_ENV=production`, `PORT=3000`, `DATABASE_URL` (from `POSTGRES_*`), `STOREFRONT_PUBLIC_URL=https://<FLUXKIT_DOMAIN>`, `MEDIA_STORAGE_DRIVER=local`, `MEDIA_DIR=/var/lib/fluxkit/media`, `MEDIA_PUBLIC_BASE_URL=https://<FLUXKIT_DOMAIN>/media`, `MEILI_URL=http://meilisearch:7700`, `API_INTERNAL_URL=http://api:3000` (storefront).

Required in the env file: `FLUXKIT_DOMAIN`, `FLUXKIT_CERTS_DIR`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `ORDER_TOKEN_SECRET`, `TRUST_PROXY`, plus `MEILI_MASTER_KEY` in `infra/meilisearch.env`. Everything else has a default (`.env.example` and `docs/contracts/config.md` explain each variable; `pnpm check:env` keeps `.env.example` complete).

- `TRUST_PROXY=1` matches the example (the edge is the only proxy and replaces `X-Forwarded-For`). With a CDN or load balancer in front of the edge it becomes 2, and the edge must then APPEND instead of replace (`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` in `infra/proxy/nginx/snippets/forwarded-headers.conf`, the ONE snippet that both the API locations and the storefront location include, so the change covers the search results page too; ADR 0038): too high lets a client choose its rate-limit key, too low puts every shopper into one window (ADR 0024, README "Deployment notes").
- `STOREFRONT_FORWARD_CLIENT_ADDRESS=true` (the example's value; ADR 0038) makes the storefront pass the edge's `X-Forwarded-For` on to the API for the search results page, so its `search` window counts shoppers. **The storefront must be reachable only through the edge when this is on** (the Compose example publishes no storefront port): a client that reaches `next start` directly would choose its own rate-limit key, or use up another address's window. Unset or `false`: every results page counts as the Next server's one address (one shared window for page searches; the browser's own `/store/*` calls stay per shopper).
- `STOREFRONT_IMAGE_HOSTS` is frozen into the storefront's CSP when the image is BUILT (Compose passes it as a build argument and again at run time) and becomes the admin's `img-src` at the edge: rebuild the storefront after a change. With uploads in use, the shop's own domain belongs in it.
- `ADMIN_COOKIE_SECURE` and `STORE_COOKIE_SECURE` stay `true` (HTTPS).
- With `EMAIL_PROVIDER=none` the API logs one warning at start; password reset and order mail are then off (`docs/api/customers.md`).

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

## TLS

The nginx edge reads `fullchain.pem` and `privkey.pem` from `FLUXKIT_CERTS_DIR` (mounted read-only; the files must be readable by uid 101). It does not obtain certificates itself. Options:
- certbot on the host with the webroot of the `acme-webroot` volume (port 80 serves `/.well-known/acme-challenge/` from it): `certbot certonly --webroot -w "$(docker volume inspect -f '{{.Mountpoint}}' fluxkit_acme-webroot)" -d shop.example.com`, then copy or link the files into `FLUXKIT_CERTS_DIR`. After each renewal: `docker compose ... exec edge nginx -s reload`.
- A DNS-01 client, or a load balancer that terminates TLS (then it is a proxy hop: see `TRUST_PROXY`).
- Or the Caddy edge (below), which obtains and renews certificates itself.

The edge offers TLS 1.2 and 1.3, sends `Strict-Transport-Security: max-age=31536000` on every https answer (one header: the storefront's own copy is removed), no `includeSubDomains` or `preload` (decide that for the whole domain first), and redirects port 80 to `https://<FLUXKIT_DOMAIN>` (never to a client-supplied host).

## The edge proxy (nginx)

- Routes: `^/(store|media)(/|$)`, `^/admin(/|$)` and `^/webhooks/payments(/|$)` to the API; `^/admin-ui/assets/` and `^/admin-ui(/|$)` from the files with the `index.html` fallback; everything else to the storefront. Upstreams are re-resolved every 10 s through Docker's resolver, so a recreated container is found without restarting the edge (smoke-tested).
- Request bodies: 1 MB by default (the API's own JSON limit is 100 KB); `/admin` 12 MB and streamed to the API (`proxy_request_buffering off`; keep it above `MEDIA_MAX_BYTES`); `/webhooks/payments` 64 KiB, the API's limit, buffered, forwarded byte for byte (the signature is checked over the raw body, ADR 0032).
- `/media/*`: no cache rule and no header of the edge's own; the API sends `Cache-Control` (immutable for a file, `no-store` for a 404). If you put a CDN in front, let it follow those headers.
- `/admin-ui`: the headers of `apps/admin/security-headers.ts` (copied; `apps/admin/edge-proxy-headers.spec.ts` fails when they drift), including `style-src-attr 'unsafe-inline'`, plus HSTS; `no-cache` on the HTML, `immutable` on existing hashed assets only (a missing asset is a plain 404).
- `X-Powered-By` of Express and Next is removed. `server_tokens off`.
- Client addresses: the edge sets `X-Forwarded-For` to the address it saw (`$remote_addr`), replacing any value the client sent, and the API trusts one hop (`TRUST_PROXY=1`). The smoke test checks both directions: an invented `X-Forwarded-For` does not open a new window, and a second client address keeps its own. The rule (with `Host` and `X-Forwarded-Proto`) lives in `snippets/forwarded-headers.conf`, included by `proxy-to-api.conf` and by the storefront location alike: the storefront passes the header on to the API for the search window (`STOREFRONT_FORWARD_CLIENT_ADDRESS`, ADR 0038), so the two paths must never differ. `apps/api/src/payments/webhook/edge-proxy-config.spec.ts` fails when a location sets the header itself or a second rule appears. Checked with the pinned nginx image (search UI review fixes): `nginx -t` passes, and an invented `X-Forwarded-For` reaches the API and the storefront upstreams replaced by the client's address; with the snippet switched to `$proxy_add_x_forwarded_for` both receive the appended chain.
- **IPv6 caveat (not verified here):** Docker forwards published ports to an IPv4-only bridge network through `docker-proxy` for IPv6 clients, so nginx sees the gateway address for all of them and they share one rate-limit window. Remedies: enable IPv6 on the Docker network (`enable_ipv6` with an IPv6 subnet) or run the edge with `network_mode: host` (then point it at the API and storefront by published loopback ports). Loopback traffic from the host also arrives from the gateway address (seen in the smoke test).
- The start-up script `16-fluxkit-env.envsh` refuses a missing or malformed `FLUXKIT_DOMAIN`, a malformed upstream, or an image host that is not a bare lower-case host name (the rule of `security-headers.ts`); the container then stops instead of serving a wrong policy.

### Caddy alternative

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
2. `git pull` (or new image tags), then `docker compose ... build` and `docker compose ... up -d --wait`.
3. Compose recreates the changed containers: `migrate` runs the new migrations while the old API is still serving, then the new API replaces the old one. Expect a few seconds of `502` from the edge while the single API restarts: **the example has no zero-downtime rollout** (one instance is required today). Additive migrations (the project's rule) keep the old API working while they run.
4. If `migrate` fails, Compose does not start the new API (it waits for `service_completed_successfully`). Whether the old API container is still serving at that moment was not tested here: plan for downtime. Read `docker compose ... logs migrate`, fix, run `up` again.
5. Rollback: stop the API, run the newest `apps/api/drizzle/NNNN_name.down.sql` against the database (`docker compose ... exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 < apps/api/drizzle/NNNN_name.down.sql`), one migration at a time from the newest, then start the previous image tag. The migrator refuses to run code older than the database.
6. Old images stay on the host after an update (each release built there adds about 1.5 GB of images plus build cache). Keep the running tag and the previous one for rollback, remove older `fluxkit-*` tags (section "Disk space").

## Backups

- **Postgres**: `docker compose ... exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > fluxkit-$(date +%F).dump` (daily, kept off the host). Restore into an empty database with `pg_restore`.
- **Media volume** (`MEDIA_DIR`): back it up AFTER the database dump (files are only added; README "Uploaded images" explains why this order is safe): `docker run --rm -v fluxkit_media:/m:ro -v "$PWD":/b alpine tar -C /m -czf /b/media-$(date +%F).tgz .`
- **Search index**: no backup needed. It is rebuilt from Postgres (see "Catalog search"); after a database restore run the reindex command.
- **Secrets**: `infra/production.env` (at least `ORDER_TOKEN_SECRET`) belongs with the backups, encrypted.
- A restore has never been tested in this repository: test one before going live.

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
- [ ] `TRUST_PROXY` equals the number of proxies in front of the API; from two different networks a limited route (for example the admin login) is counted separately.
- [ ] Exactly one `api` container; `SCHEDULER_ENABLED=true` there (or a cron running `run-once`).
- [ ] First owner created; `pnpm seed` NOT run; demo methods or products not present.
- [ ] The API runs as a database role that owns no table and has no `TRUNCATE` (Database roles); the owner role's password is not in the API's environment.
- [ ] `EMAIL_PROVIDER`, `PAYMENT_PROVIDERS_ENABLED` and `SHIPPING_PROVIDERS_ENABLED` decided (the fakes are refused in production); for Monobank the webhook URL `https://<domain>/webhooks/payments/monobank` reachable from the internet.
- [ ] `STOREFRONT_IMAGE_HOSTS` set before the storefront image was built; an uploaded image shows in the storefront (hairpin works).
- [ ] Backups of Postgres and the media volume scheduled and a restore tested.
- [ ] Search: `infra/meilisearch.env` written (master key generated), the scoped key made, `SEARCH_ENABLED=true`, `GET /store/config` says `search: true`, a product found after the index is built; the engine's port is not published.
- [ ] Swagger UI decision (not routed by the example).
- [ ] Launch blockers in `docs/HANDOFF.md` reviewed (catalog read rate limits, privacy plan before the EU launch).
- [ ] The Docker images' own licences reviewed before images are handed to a client (below).

## Smoke test

`bash scripts/deploy-smoke.sh` builds the three images, starts the Compose example (including the search engine: it creates the scoped key, switches search on and checks `/store/config` and `/store/search`) under the project name `fluxkit-smoke` on `127.0.0.1:18080` and `127.0.0.1:18443` with a throwaway env file and a self-signed certificate in `infra/.smoke/` (git-ignored), runs the checks and removes everything (`--keep` leaves the stack up). Needs Docker with Compose and BuildKit, `openssl`, `curl`, `jq`. Behind a TLS-intercepting proxy, pass a base image that trusts its CA: `SMOKE_BUILD_ARGS="--build-arg NODE_IMAGE=<your node image>"` (the `NODE_IMAGE` argument of the Dockerfile; that is how it ran in the agent sandbox).

## Licences of the images

The images are external tooling, not linked code (AGENTS.md section 16): Node.js (MIT) on Debian bookworm-slim, nginx (BSD-2-Clause) on Alpine (the `nginxinc/nginx-unprivileged` image, Apache-2.0 packaging), PostgreSQL (PostgreSQL licence), Caddy (Apache-2.0). The base layers contain GPL and LGPL system packages (for example bash, coreutils and glibc in Debian, BusyBox in Alpine). Running them is fine; **handing built images to a client is a distribution** of those packages, which brings source-offer duties. That decision is the owner's and legal's (`docs/dependencies.md`); until then deliver the repository and let the client build.
