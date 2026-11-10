# Plan: first deployment on the Hetzner host (2026-11-10)

Status: **approved by the owner and carried out on 2026-11-10** (results: section 13).

Owner's decisions (2026-11-10): stop (not remove) the AutoFlow forwarder; no resize, add swap and try on the current host
(stop at the first OOM); no domain yet (`FLUXKIT_DOMAIN` = the IP, self-signed certificate, no Let's Encrypt); no
providers (`EMAIL_PROVIDER=none`, no payment or shipping provider). Proxy: nginx edge (the default). Release: `7349a1b`
(= `origin/main`). Exact commands: section 12.
Goal: run the production Compose example (`docs/deployment.md`) on one real host for the first time, verify it, and write down what holds and what does not.
Not a launch: no real payment, mail or shipping keys, no demo data, no public announcement.

## 1. The host as found (read-only inspection, 2026-11-10)

| Item | Value |
|---|---|
| Host | Hetzner Cloud, `178.104.79.222`, hostname `ubuntu-2gb-nbg1-1`, x86_64, reached through the local SSH alias for this address (key-only root login) |
| OS | Ubuntu 26.04 LTS, kernel 7.0.0-15; **reboot pending** (`/var/run/reboot-required`: newer kernel, libc6); unattended-upgrades on; up 119 days |
| CPU / RAM / swap | **1 vCPU, 1.9 GiB RAM (1.4 GiB available), no swap** |
| Disk | 38 GB, 24 GB free; Docker uses 5.8 GB (2.1 GB of it reclaimable images, not ours) |
| Docker | Engine 29.6.1, Compose v5.3.1 (meets "Engine 25+, Compose 2.20+") |
| Listening | 22 (sshd), **80/443 TCP and 443 UDP held by Caddy in `autoflow-migration-source-forwarder`** (host network, `restart: unless-stopped`) |
| Other workload | Project **AutoFlow** (`/opt/autoflow`, `/opt/autoflow-migration-2026-11-05`): its stack is stopped since 2026-11-05 (moved to another host); left running are the forwarder (proxies `autos-sale.com`, `www.`, `media.` to `46.224.60.223`) and the systemd unit `autoflow-migration-source-fence.service`. Public DNS of all three names already points to `46.224.60.223` |
| Firewall | ufw inactive; only Docker's nftables chains. A Hetzner Cloud Firewall cannot be seen from inside the host (owner to check in the console) |
| SSH | `PermitRootLogin prohibit-password`, **`PasswordAuthentication yes`** |
| Tools | git, openssl, curl present; no jq, certbot, nginx (host), fail2ban |
| Cron | none for root |

## 2. Blockers (owner decides before anything changes)

1. **Ports 80/443 are taken by AutoFlow's forwarder.** Fluxkit's edge needs them for a public domain and certificates. Options: (a) the owner confirms the forwarder can stop (DNS moved 5 days ago; stale resolvers would lose `autos-sale.com` through this host); (b) Fluxkit runs on other ports for a non-public test first (`FLUXKIT_HTTP_PORT`/`FLUXKIT_HTTPS_PORT`, self-signed certificate, no ACME); (c) another server. The plan never stops or removes AutoFlow containers, volumes, files or units without an explicit "yes".
2. **The host is too small.** `docs/deployment.md` asks for ~2 GB free for the API plus 1 GB for the storefront; the Compose limits are 1 GB each for api, storefront and meilisearch, plus Postgres. 1.9 GiB total without swap will OOM at run time, and the storefront image build (`next build`) will not fit at all. Recommended: resize to at least 2 vCPU / 4 GB (better 8 GB) in the Hetzner console, and add a 2 to 4 GB swap file as a safety net. A resize needs a power-off (owner's action; it also briefly stops the forwarder).
3. **Fake providers are refused in production.** With `NODE_ENV=production` (fixed by the Compose file) `loadEnv` refuses `EMAIL_PROVIDER=fake`, `PAYMENT_PROVIDERS_ENABLED=fake` and `SHIPPING_PROVIDERS_ENABLED=fake` (`docs/contracts/config.md`). So "mail and payments in fake mode" cannot run in this set-up. Proposed instead: `EMAIL_PROVIDER=none`, no payment and no shipping provider (orders paid and shipped by hand), and verify that the shop states this correctly (`/store/config`: `emailDelivery: false`, `onlinePayment: false`). Fake flows stay covered by CI e2e. Overriding `NODE_ENV` is rejected: it also switches off production checks (secure cookies, required secrets).

## 3. What gets installed and where

- Nothing on the host apart from what Docker already provides, a swap file (if approved) and, for TLS, the official `certbot/certbot` image run on demand (no host package).
- Code: an exact commit, exported locally with `git archive <sha> | ssh <host> tar -x -C /opt/fluxkit/releases/<sha>`, symlink `/opt/fluxkit/current`. No git credentials or deploy key on the server; no `.git` there.
- Images: built **on the host** after the resize (the local machine is arm64; the host is amd64, and cross-building `next build` under emulation is slow). Tag = short commit SHA (`FLUXKIT_IMAGE_TAG`), so the previous release stays available for rollback.
- Compose project name `fluxkit` (volumes `fluxkit_postgres-data`, `fluxkit_meili-data`, `fluxkit_media`, `fluxkit_acme-webroot`); no name clash with `autoflow_*`.
- Containers: `postgres`, `migrate` (one-shot), `api` (also the scheduler), `storefront`, `edge` (nginx), `meilisearch`. **No Redis**: the example does not include it on purpose (no running code uses it, `docs/deployment.md` "Topology"), so there is no Redis password to generate.

## 4. Ports

- Public: 22 (SSH), 80 and 443 (edge only). Postgres, Meilisearch, API and storefront publish nothing.
- Firewall (after approval): ufw `allow 22,80,443/tcp` (and 443/udp only if HTTP/3 is wanted; the nginx edge does not use it), default deny incoming. Note: Docker-published ports bypass ufw; that is fine here because only the edge publishes, but it must stay that way.
- Option (b) of blocker 1: edge on e.g. 8080/8443 instead, reached by SSH tunnel or by IP only.

## 5. Configuration and secrets

- `/etc/fluxkit/production.env` and `/etc/fluxkit/meilisearch.env`, owner root, mode `600`, directory `700`; outside the release directory so a new release never touches them. Passed with `--env-file /etc/fluxkit/production.env` and `FLUXKIT_ENV_FILE` / `FLUXKIT_MEILI_ENV_FILE` set to the absolute paths.
- Secrets generated **on the server** with `openssl rand` written straight into the file (`umask 077`), never printed: `POSTGRES_PASSWORD` (hex 32), `ORDER_TOKEN_SECRET` (base64 48), `MEILI_MASTER_KEY` (hex 32). `MEILI_API_KEY` is created inside the engine container and written into the file by the same pipeline, never echoed.
- Settings: `FLUXKIT_DOMAIN=<domain>`, `STOREFRONT_IMAGE_HOSTS=<domain>`, `TRUST_PROXY=1`, `STOREFRONT_FORWARD_CLIENT_ADDRESS=true`, `EMAIL_PROVIDER=none`, no payment or shipping provider, `SCHEDULER_ENABLED=true` (default). `ORDER_CONTACT_RETENTION_DAYS` left unset (startup warning; legal value pending, privacy plan O5).
- Copy of both files kept by the owner in a password manager (needed for restore: `ORDER_TOKEN_SECRET`).

## 6. TLS

- Recommended: the **nginx edge** (the default, the only one smoke-tested with the real API and storefront) plus a Let's Encrypt certificate from the `certbot/certbot` container using the `fluxkit_acme-webroot` volume (http-01), copied into `/etc/fluxkit/certs` (readable by uid 101); renewal by a systemd timer that runs certbot and then `docker compose ... exec edge nginx -s reload`.
- Chicken and egg: the edge refuses to start without `fullchain.pem`/`privkey.pem`. First start uses a short-lived self-signed certificate, then certbot replaces it and the edge reloads.
- Caddy (automatic HTTPS) is the documented alternative but is not wired into the Compose file and never ran with the real API or storefront; not chosen for the first deployment.
- Requires: a domain whose A record points to `178.104.79.222` and port 80 free (blocker 1).

## 7. Deployment steps (each state-changing command shown to the owner first)

1. Owner: resize, decide on the forwarder, give the domain. Optional host hardening (separately approved): reboot for the pending kernel, `PasswordAuthentication no`, ufw.
2. Swap file 4 GB (`/swapfile`, `vm.swappiness=10`).
3. Upload the release (section 3), write the env files and secrets (section 5), self-signed certificate.
4. `docker compose --env-file /etc/fluxkit/production.env -f infra/docker-compose.prod.yml build`, then `up -d --wait`. `migrate` runs `node dist/database/migrate.js` (the container form of `pnpm db:migrate`, forward only).
5. First owner: `docker compose ... run --rm --no-deps api node dist/auth/create-admin.js --email <owner email>` in an interactive SSH session **the owner types the password into** (the container form of `pnpm admin:create`).
6. Certificate from certbot, edge reload, renewal timer.
7. Search: scoped key, `SEARCH_ENABLED=true`, recreate `api` (`docs/deployment.md`, "Catalog search").
8. Backups (section 8) and one restore test into a scratch database.
9. Not done: `pnpm seed` (refused under production, no demo data); separate application database role (`docs/deployment.md`, "Database roles") is proposed as a follow-up step after the first start.

## 8. Backups of Postgres

- Daily systemd timer: `docker compose ... exec -T postgres pg_dump -Fc` to `/var/backups/fluxkit/db-<date>.dump` (mode 600), then the media volume tar AFTER the dump; keep 14 days on the host.
- Off-host copy is required (a host backup does not survive losing the host): owner chooses Hetzner Storage Box, another server, or a pull to the owner's machine via `scp`. Hetzner's own server backups (snapshot of the whole disk, paid option) are an extra layer, not a replacement.
- Restore test: `pg_restore` into a scratch database in the same Postgres container, count rows of the main tables, drop the scratch database.
- Meilisearch: no backup (rebuilt from Postgres).

## 9. Rollback

- First deployment (nothing to roll back to): `docker compose ... down` (WITHOUT `-v`) stops Fluxkit and frees the ports; volumes stay. Removing volumes is a separate destructive step needing an explicit "yes".
- Later releases: back up first; images are tagged by commit, so `FLUXKIT_IMAGE_TAG=<previous sha> up -d --wait` returns to the previous code. If the new release ran a migration, the matching `apps/api/drizzle/NNNN_*.down.sql` is applied by hand, newest first (`docs/deployment.md` "Updates and migrations"), or the dump is restored.
- If the forwarder was stopped: `docker start autoflow-migration-source-forwarder` brings it back as it was (after `down` of Fluxkit's edge).

## 10. Verification

- `docker compose ps`: all healthy, `migrate` exited 0; `docker compose logs` of every service without errors (expected warnings: `EMAIL_PROVIDER=none`, no retention period).
- Through the edge (`curl` from the host and from outside): `/uk`, `/en`, catalog page, `/store/config` (`emailDelivery: false`, `onlinePayment: false`, `search` as set), `/admin-ui/` loads with its CSP, admin sign-in with the owner account (owner does it in a browser), HTTP to HTTPS redirect, HSTS, `/docs` and `/health` NOT routed, Postgres and Meilisearch ports not reachable from outside.
- The API `/health` is checked inside the network (Compose healthcheck), since the edge deliberately does not route it.
- Memory under load: `docker stats` after first page loads; any OOM kill stops the rollout.
- Not verifiable in this deployment: real mail, real payments and webhooks, Nova Post, IPv6 rate-limit caveat (`docs/deployment.md`).

## 11. Before the domain goes public (reminders)

- Legal texts filled in and the storefront built with `STOREFRONT_REQUIRE_LEGAL_TEXT=true` (placeholders refuse the build).
- Backups running off-host and a restore tested.
- Branch protection on `main` (GitHub).
- Live provider keys (Monobank, Resend, Nova Post) only on the owner's command; then `STOREFRONT_PUBLIC_URL` https and the Monobank webhook URL reachable.
- Remaining items of the readiness checklist in `docs/deployment.md` (application DB role, Swagger decision, launch blockers in `docs/HANDOFF.md`).

## Risks

- Shared host with another project's leftover services (blocker 1); a mistake there affects a live site's stale traffic.
- First real run of the example: unknown failures are likely (certificate permissions for uid 101, hairpin to the own domain for the image optimizer, memory).
- Single host, single API container: no high availability; updates have a short `502` window.

## 12. Exact commands of this deployment (approved as a whole by the owner's "ok"; anything not listed is asked again)

Host commands run as root over SSH. `fk` is the wrapper written in step A5. No command prints a secret.

| Step | Where | Command | Undo |
|---|---|---|---|
| A1 | host | `docker stop autoflow-migration-source-forwarder` (frees 80/443; `unless-stopped` keeps it stopped after a reboot; the fence unit is NOT touched) | `docker start autoflow-migration-source-forwarder` |
| A2 | host | `fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab && echo vm.swappiness=10 > /etc/sysctl.d/99-fluxkit-swap.conf && sysctl -p /etc/sysctl.d/99-fluxkit-swap.conf` | `swapoff /swapfile`, remove the fstab line and the files |
| A3 | local to host | `git archive --format=tar 7349a1b \| ssh <host> 'mkdir -p /opt/fluxkit/releases/7349a1b && tar -x -C /opt/fluxkit/releases/7349a1b && ln -sfn /opt/fluxkit/releases/7349a1b /opt/fluxkit/current'` | `rm -rf /opt/fluxkit` |
| A4 | host | `install -d -m 700 /etc/fluxkit`; `install -d -m 750 -o root -g 101 /etc/fluxkit/certs`; with `umask 077` write `/etc/fluxkit/production.env` (`FLUXKIT_DOMAIN=178.104.79.222`, `FLUXKIT_CERTS_DIR=/etc/fluxkit/certs`, `FLUXKIT_IMAGE_TAG=7349a1b`, `POSTGRES_USER=fluxkit`, `POSTGRES_DB=fluxkit`, `POSTGRES_PASSWORD=$(openssl rand -hex 32)`, `ORDER_TOKEN_SECRET=$(openssl rand -base64 48)`, `TRUST_PROXY=1`, `STOREFRONT_IMAGE_HOSTS=178.104.79.222`, `STOREFRONT_FORWARD_CLIENT_ADDRESS=true`, `EMAIL_PROVIDER=none`) and `/etc/fluxkit/meilisearch.env` (`MEILI_MASTER_KEY=$(openssl rand -hex 32)`); then `openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj /CN=178.104.79.222 -addext subjectAltName=IP:178.104.79.222` into `certs/fullchain.pem` and `certs/privkey.pem`, `chown root:101`, `chmod 640` | `rm -rf /etc/fluxkit` (destroys the secrets: only together with the database volume) |
| A5 | host | `/opt/fluxkit/fk`: `cd /opt/fluxkit/current`, `FLUXKIT_ENV_FILE` and `FLUXKIT_MEILI_ENV_FILE` set to the files above, `exec docker compose --env-file /etc/fluxkit/production.env -f infra/docker-compose.prod.yml "$@"` | `rm /opt/fluxkit/fk` |
| B1 | host | one image at a time (2 GB RAM): `fk build migrate`, `fk build storefront`, `fk build edge`, each detached (`setsid nohup ... > /var/log/fluxkit-build-<name>.log`) so a dropped SSH connection does not kill it | `docker image rm fluxkit-{api,storefront,edge}:7349a1b` |
| B2 | host | `fk up -d --wait` (postgres, meilisearch, migrate, api, storefront, edge) | `fk down` (never `-v`) |
| B3 | owner's terminal | `ssh -t <host> /opt/fluxkit/fk run --rm --no-deps api node dist/auth/create-admin.js --email <owner email>`: the owner types the password | `node dist/auth/...` has no delete; an extra admin is removed in the admin UI |
| B4 | host | scoped search key made inside the engine container (`docs/deployment.md`), its `key` field parsed by `python3` and appended with `SEARCH_ENABLED=true` to `production.env` without printing; `fk up -d --no-deps --force-recreate --wait api` | remove the two lines, recreate `api` |
| C1 | host | backups (section 8) as a systemd service and timer, paths `/usr/local/sbin/fluxkit-backup`, `/var/backups/fluxkit`; one restore test into a scratch database `fluxkit_restore_test` that is dropped afterwards | `systemctl disable --now fluxkit-backup.timer`, remove the files |

Not part of this approval (asked separately if wanted): reboot for the pending kernel, `PasswordAuthentication no`, ufw,
removing AutoFlow images or containers, the separate application database role.

Known limits of this set-up: browsers warn about the self-signed certificate; the storefront's image optimizer cannot fetch
uploaded images over the hairpin `https://178.104.79.222/media/...` (untrusted certificate), so uploaded product images may
not render until a real domain and certificate exist; Let's Encrypt does not issue for a bare IP here.

## 13. Results (2026-11-10)

Done (steps A1 to C1 of section 12, in that order, plus one step outside the plan):

| Step | Result |
|---|---|
| A1, A2 | Forwarder stopped (not removed); 4 GB swap, `vm.swappiness=10` |
| A3 to A5 | Release `7349a1b` in `/opt/fluxkit/releases/7349a1b`; `/etc/fluxkit/{production,meilisearch}.env` (600, secrets generated on the host, never printed); self-signed certificate valid 30 days (until 2026-12-10); wrapper `/opt/fluxkit/fk` |
| B1 | Built on the host one at a time: `fluxkit-api` 554 MB (about 3 min), `fluxkit-storefront` 903 MB (about 2.5 min), `fluxkit-edge` 84 MB; no OOM |
| B2 | `up -d --wait`: all healthy; `migrate` applied `0000` to `0012` (13 migrations) and exited 0. Expected API warnings only: `EMAIL_PROVIDER` none, no `ORDER_CONTACT_RETENTION_DAYS` |
| B4 | Scoped key created inside the engine (helper `/opt/fluxkit/create-search-key.sh`), `SEARCH_ENABLED=true`; job 14 built both indexes |
| C1 | `/usr/local/sbin/fluxkit-backup` + `fluxkit-backup.timer` (daily 03:30 UTC, 14 days in `/var/backups/fluxkit`); `/usr/local/sbin/fluxkit-restore-test` restored into `fluxkit_restore_test` and matched the live counts (empty database at that time), scratch database dropped |
| B3 | Owner ran `create-admin.js` in their own terminal; sign-in at `/admin-ui/` works. A first account with the placeholder address `you@example.com` exists (the owner may delete it in the admin) |
| Outside the plan | On the owner's explicit request: backup, then `seed.js --dataset coffee --allow-production`: 90 products, 208 variants, 35 categories, 95 images, 3 banners, 16 synonym groups; 2 demo shipping methods created inactive, `demo_pickup_point` skipped (no provider). **Demo data is now in this database**: clean it or recreate the database before a real launch |

Verified from outside (curl through the edge): `http` 301 to `https`; `/uk`, `/en`, catalog, category, cart, login and search pages 200; `/admin-ui/` 200 with its CSP and `no-cache`; HSTS
`max-age=31536000`; no `X-Powered-By`; `/docs`, `/docs-json`, `/health` 404 (not routed); `/admin/*` 401 without a session; ports 3000, 3001, 5432, 6379, 7700 closed;
`/store/config` = `emailDelivery:false, onlinePayment:false, search:true`; search `стаканчик` 21 hits, synonym `кофемашина` finds `кавомашина` (4); home banners present;
`/media/*.webp` 200. Memory at idle about 200 MB for the stack.

Not verified or not working:
- **Storefront product images**: `/_next/image` answers 500, `DEPTH_ZERO_SELF_SIGNED_CERT` (the hairpin fetch of `https://178.104.79.222/media/...`). Expected with a self-signed certificate; fixed by a domain and a real certificate.
- Real mail, payments, webhooks, Nova Post (no providers); rate limits per client address from two networks; IPv6 clients; memory under real load; an update of the running shop; a restore of real data (the test ran on an empty database); the off-host copy of the backups.
- Checkout end to end in a browser (shipping methods are inactive, so checkout has no method until the owner activates one).

Open (owner):
- AutoFlow on this host: forwarder stopped (`docker start autoflow-migration-source-forwarder` restores it); the fence unit, its stopped containers, volumes and `/opt/autoflow*` were not touched.
- Host hardening not done: pending reboot (new kernel), `PasswordAuthentication yes`, ufw inactive (check the Hetzner Cloud Firewall).
- Self-signed certificate expires 2026-12-10; there is no renewal for it (Let's Encrypt comes with the domain).
- Separate application database role (`docs/deployment.md`, "Database roles") not created.

## 14. Host name and Let's Encrypt certificate (2026-11-10, owner's "yes, run 1–7")

Why: `/_next/image` answered 500 for every product picture (the optimizer's hairpin fetch refused the self-signed certificate),
while `/media/*` itself answered 200. Fix chosen by the owner: the free wildcard DNS name `178-104-79-222.sslip.io` (resolves to
the server's IP, no registration) with a Let's Encrypt certificate. `sslip.io` is not on the Public Suffix List, so all its users
share one Let's Encrypt rate limit; issuance worked on the first try.

| Step | Result | Undo |
|---|---|---|
| 1 | `fluxkit-backup` before any change: `db-2026-11-10T222437Z.dump`, `media-2026-11-10T222437Z.tgz` | - |
| 2 | `certbot/certbot` image (Docker, `certonly --webroot` on the `fluxkit_acme-webroot` volume, `--agree-tos --register-unsafely-without-email`): staging dry run, then the real certificate for `178-104-79-222.sslip.io`, issuer `YE1`, valid until 2027-02-08. State in `/etc/letsencrypt` | `rm -rf /etc/letsencrypt /var/lib/letsencrypt` |
| 3 | `/usr/local/sbin/fluxkit-install-cert` copies the live certificate into `/etc/fluxkit/certs` (`root:101`, 640) when it changed and reloads the edge. The self-signed pair is kept as `*.pem.selfsigned`; `production.env` copied to `production.env.bak-ip`, then `FLUXKIT_DOMAIN` and `STOREFRONT_IMAGE_HOSTS` set to `178-104-79-222.sslip.io` | restore the `.selfsigned` pair and `production.env.bak-ip` |
| 4 | Stored image URLs are absolute and keep their old prefix when the domain changes (`docs/contracts/config.md`, `MEDIA_PUBLIC_BASE_URL`). One transaction rewrote `media.url` from `https://178.104.79.222/media/` to `https://178-104-79-222.sslip.io/media/`: 91 of 91 rows. `brand.logo_url` and `order_item.image_url` were empty, banners reference upload ids, search documents hold no image URL (no reindex) | the reverse `UPDATE`, or restore the dump of step 1 |
| 5 | Old storefront image tagged `fluxkit-storefront:7349a1b-ip`; storefront rebuilt on the host (`STOREFRONT_IMAGE_HOSTS` is a build argument), then `fk up -d --wait`: all healthy. The `7349a1b-ip` image was deleted on 2026-11-11 on the owner's request | restore the env of step 3, rebuild the storefront (`fk build storefront`), `fk up -d --wait` |
| 6 | `/usr/local/sbin/fluxkit-cert-renew` (`certbot renew` in Docker, then `fluxkit-install-cert`) as `fluxkit-cert-renew.service` + `.timer` (04:17 and 16:17 UTC, up to 1 h random delay); `certbot renew --dry-run` succeeded | `systemctl disable --now fluxkit-cert-renew.timer`, remove the unit files and the two scripts |

Verified from outside, without skipping certificate checks: `/uk`, `/uk/catalog`, `/admin-ui/`, `/store/config` 200 with a trusted
certificate; `http://178.104.79.222/uk` 301 to `https://178-104-79-222.sslip.io/uk`; HSTS present; CSP `img-src` names the new host;
no old IP left in the catalog HTML; every optimized picture of `/uk` (11) and `/uk/catalog` (24) answers 200; the catalog shows its
pictures in Chrome.

Still open:
- `https://178.104.79.222` now shows a certificate name warning (the certificate is for the host name): use the sslip.io address.
- No expiry mail (account without email): the renewal timer is the only safeguard; check `systemctl status fluxkit-cert-renew` after its first runs.
- The pre-switch storefront image `fluxkit-storefront:7349a1b-ip` is deleted (2026-11-11): going back to the IP set-up needs a storefront rebuild.
- A real domain later means the same steps 2 to 5 again (new certificate, `FLUXKIT_DOMAIN`, `STOREFRONT_IMAGE_HOSTS`, URL rewrite, storefront rebuild).

## 15. Disk space housekeeping (2026-11-11, owner's "yes, add both")

Before: 15 GB free of 38 GB; Fluxkit images about 1.5 GB (one release), Docker build cache 4.1 GB (2.7 GB reclaimable), most other
image space belongs to AutoFlow (about 60 `klukvas/autoflow-*` and `autoflow-*` images, 2.4 GB reclaimable by Docker's count; not
touched). Nothing removed old images or build cache, and nothing warned about low space.

| Piece | What it does | Undo |
|---|---|---|
| `/usr/local/sbin/fluxkit-prune-images [--dry-run]` | For `fluxkit-api`, `fluxkit-storefront`, `fluxkit-edge`: keeps `FLUXKIT_IMAGE_TAG` from `production.env` and the newest other tag (rollback), removes older tags unless a container (running or stopped) uses the image. Touches no other repository. Run it after each update; the weekly unit runs it too | `rm` the script |
| `fluxkit-disk-cleanup.service` + `.timer` (Sundays 04:45 UTC) | `fluxkit-prune-images`, then `docker builder prune --force --filter until=168h` (cache unused for a week; shared with any other build on the host) | `systemctl disable --now fluxkit-disk-cleanup.timer`, remove the unit files and `/usr/local/sbin/fluxkit-disk-cleanup` |
| `fluxkit-disk-check.service` + `.timer` (hourly) | Below `FLUXKIT_DISK_MIN_FREE_GB` (default 5) free on `/`: `logger -p user.warning -t fluxkit-disk` and the unit fails (`systemctl --failed`, `journalctl -t fluxkit-disk`) | `systemctl disable --now fluxkit-disk-check.timer`, remove the unit files and `/usr/local/sbin/fluxkit-disk-check` |

Checks: dry run with one release keeps everything; with temporary aliases the script kept the newer one as "previous", kept
an alias whose image a stopped AutoFlow container uses, and removed unused older tags (throwaway `FROM scratch` images, removed
afterwards). First cleanup run freed 11 MB of build cache (the rest is younger than a week). The disk check reports `ok` at 14 GB
free; with a threshold of 100 GB it logged the warning and exited 1.

Not done: the warning reaches only the journal (the host sends no mail; a notification channel is a separate decision);
AutoFlow's images stay until the owner decides.
