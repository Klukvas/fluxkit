#!/usr/bin/env bash
# Smoke test of the production example (docs/deployment.md): builds the three images, starts
# infra/docker-compose.prod.yml under its own project name with a throwaway env file and a self-signed certificate,
# checks routing, headers, TLS, the webhook route, the media volume, the read-only file systems and the per-client rate
# limit through the edge, then removes the project and its volumes.
#
# Usage: bash scripts/deploy-smoke.sh [--keep]     (--keep leaves the stack running for a look; remove it with the
#                                                  `docker compose ... down -v` line the script prints)
# Needs: docker with Compose and BuildKit, openssl, curl, jq; the host deploy check needs flock and GNU sed (Linux). Ports 18080 and 18443 on 127.0.0.1 must be free.
# Extra arguments for every `docker build` (for example a base image with a corporate CA) go into SMOKE_BUILD_ARGS.
set -euo pipefail

cd "$(dirname "$0")/.."

KEEP=false
if [[ "${1:-}" == "--keep" ]]; then KEEP=true; fi

PROJECT=fluxkit-smoke
DOMAIN=shop.fluxkit.test
HTTP_PORT=18080
HTTPS_PORT=18443
WORK=infra/.smoke
TAG=5a0e001
NEXT_TAG=5a0e002
BROKEN_TAG=5a0e003
REQUEST_PID=
PREFIX=fluxkit-smoke
ORIGIN="https://${DOMAIN}:${HTTPS_PORT}"
OWNER_EMAIL=owner@fluxkit.test
OWNER_PASSWORD=smoke-owner-password-0123456789

fail() {
  echo "FAIL: $*" >&2
  exit 1
}
pass() { echo "ok   $*"; }

compose() {
  docker compose -p "$PROJECT" --env-file "$WORK/production.env" -f infra/docker-compose.prod.yml "$@"
}

cleanup() {
  local status=$?
  if [[ -n "$REQUEST_PID" ]]; then
    touch "$WORK/stop-requests"
    wait "$REQUEST_PID" || true
  fi
  if [[ "$status" -ne 0 ]]; then
    echo "--- compose ps and logs (failure) ---" >&2
    compose ps -a >&2 || true
    compose logs --no-color --tail 80 >&2 || true
  fi
  if [[ "$KEEP" == "true" ]]; then
    echo "Stack kept. Remove it with: docker compose -p $PROJECT --env-file $WORK/production.env -f infra/docker-compose.prod.yml down -v"
  else
    compose down -v --remove-orphans >/dev/null 2>&1 || true
    rm -rf infra/.smoke
  fi
  exit "$status"
}

# --- work directory: env file and a self-signed certificate (never real secrets) ---
rm -rf infra/.smoke
mkdir -p "$WORK/certs"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=${DOMAIN}" \
  -addext "subjectAltName=DNS:${DOMAIN}" \
  -keyout "$WORK/certs/privkey.pem" -out "$WORK/certs/fullchain.pem" 2>/dev/null
# Readable by the edge's nginx user (uid 101); a throwaway key, never a real one.
chmod 0644 "$WORK/certs/privkey.pem" "$WORK/certs/fullchain.pem"
CA="$WORK/certs/fullchain.pem"

SMOKE_REDIS_PASSWORD=$(openssl rand -hex 32)
cat >"$WORK/production.env" <<EOF
COMPOSE_PROJECT_NAME=${PROJECT}
FLUXKIT_API_REPLICAS=2
FLUXKIT_STOREFRONT_REPLICAS=2
FLUXKIT_DOMAIN=${DOMAIN}
FLUXKIT_CERTS_DIR=$(pwd)/${WORK}/certs
FLUXKIT_ENV_FILE=$(pwd)/${WORK}/production.env
FLUXKIT_MEILI_ENV_FILE=$(pwd)/${WORK}/meilisearch.env
FLUXKIT_IMAGE_PREFIX=${PREFIX}
FLUXKIT_IMAGE_TAG=${TAG}
FLUXKIT_HTTP_PORT=127.0.0.1:${HTTP_PORT}
FLUXKIT_HTTPS_PORT=127.0.0.1:${HTTPS_PORT}
POSTGRES_USER=fluxkit
POSTGRES_PASSWORD=$(openssl rand -hex 24)
POSTGRES_DB=fluxkit
REDIS_PASSWORD=${SMOKE_REDIS_PASSWORD}
RATE_LIMIT_STORE=redis
REDIS_URL=redis://:${SMOKE_REDIS_PASSWORD}@redis:6379
ORDER_TOKEN_SECRET=$(openssl rand -hex 32)
TRUST_PROXY=1
STOREFRONT_IMAGE_HOSTS=${DOMAIN}
STOREFRONT_FORWARD_CLIENT_ADDRESS=true
EOF
# The engine's master key is in its own file: the api never receives it (docs/deployment.md).
printf 'MEILI_MASTER_KEY=%s\n' "$(openssl rand -hex 24)" >"$WORK/meilisearch.env"
trap cleanup EXIT

# --- the deploy script's rolling helpers, without Docker (fast; the real script runs against the stack at the end) ---
bash infra/deploy/fluxkit-deploy.spec.sh
pass "fluxkit-deploy rolling helpers (infra/deploy/fluxkit-deploy.spec.sh)"
bash infra/docker/stop-linger.spec.sh
pass "stop linger keeps a retiring replica in DNS (infra/docker/stop-linger.spec.sh)"

# --- images ---
read -r -a EXTRA_BUILD_ARGS <<<"${SMOKE_BUILD_ARGS:-}"
for target in api storefront edge; do
  echo "building $target"
  # ${arr[@]+...}: bash 3.2 (macOS) treats an empty array as unset under `set -u`.
  docker build --quiet ${EXTRA_BUILD_ARGS[@]+"${EXTRA_BUILD_ARGS[@]}"} --target "$target" \
    --build-arg "STOREFRONT_IMAGE_HOSTS=${DOMAIN}" -t "${PREFIX}-${target}:${TAG}" . >/dev/null
  docker tag "${PREFIX}-${target}:${TAG}" "${PREFIX}-${target}:${NEXT_TAG}"
done
pass "images built: ${PREFIX}-api, ${PREFIX}-storefront, ${PREFIX}-edge"

# Feature migrations ship in the API image (blog plan E1, ADR 0049): every journal entry of every feature with a drizzle/
# folder has its migration and its hand-written .down.sql (the removal steps run it by hand); the blog must be among them.
FEATURE_JOURNALS=$(docker run --rm "${PREFIX}-api:${TAG}" node -e '
const fs = require("node:fs");
const path = require("node:path");
const root = "/app/packages/features";
for (const name of fs.readdirSync(root)) {
  const folder = path.join(root, name, "drizzle");
  const journalFile = path.join(folder, "meta", "_journal.json");
  if (!fs.existsSync(journalFile)) continue;
  const { entries } = JSON.parse(fs.readFileSync(journalFile, "utf8"));
  for (const { tag } of entries) {
    for (const file of [`${tag}.sql`, `${tag}.down.sql`]) {
      if (!fs.existsSync(path.join(folder, file))) console.log(`missing ${name}/drizzle/${file}`);
    }
  }
  console.log(`journal ${name} ${entries.length}`);
}
') || fail "could not read the feature migrations in the API image"
[[ "$FEATURE_JOURNALS" != *missing* ]] || fail "feature migration files missing in the API image: $FEATURE_JOURNALS"
[[ "$FEATURE_JOURNALS" == *"journal blog "* ]] || fail "the blog's migration journal is not in the API image"
pass "feature migrations and their .down.sql files are in the API image ($(tr '\n' ' ' <<<"$FEATURE_JOURNALS"))"

# The image installs with `pnpm install --prod`, which links no peer of a workspace package: every provider and feature
# package must resolve @nestjs/common on its own, to the API's very copy (one Nest, one HttpException class), or the API
# fails at start once that package is enabled. The guard in the repository is apps/api/src/common/workspace-runtime-dependencies.spec.ts.
NEST_RESOLUTION=$(docker run --rm "${PREFIX}-api:${TAG}" node -e '
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const nestOf = (folder) => fs.realpathSync(createRequire(path.join(folder, "package.json")).resolve("@nestjs/common"));
const apiNest = nestOf("/app/apps/api");
for (const group of ["providers", "features"]) {
  const root = path.join("/app/packages", group);
  for (const name of fs.readdirSync(root)) {
    const folder = path.join(root, name);
    if (!fs.existsSync(path.join(folder, "package.json"))) continue;
    let resolved;
    try { resolved = nestOf(folder); } catch (error) { console.log(`unresolved ${group}/${name} ${error.code}`); continue; }
    console.log(resolved === apiNest ? `nest ${group}/${name}` : `other-copy ${group}/${name} ${resolved}`);
  }
}
') || fail "could not check @nestjs/common in the API image's packages"
[[ "$NEST_RESOLUTION" != *unresolved* && "$NEST_RESOLUTION" != *other-copy* ]] ||
  fail "a package in the API image does not resolve the API's @nestjs/common: $NEST_RESOLUTION"
[[ "$NEST_RESOLUTION" == *"nest providers/nova-post"* && "$NEST_RESOLUTION" == *"nest providers/brevo"* && "$NEST_RESOLUTION" == *"nest features/blog"* ]] ||
  fail "the Nest check found no provider or feature packages in the API image: $NEST_RESOLUTION"
pass "every provider and feature package resolves the API's @nestjs/common ($(tr '\n' ' ' <<<"$NEST_RESOLUTION"))"

compose config --quiet
compose up -d --no-build --wait --wait-timeout 180
pass "stack healthy (postgres, meilisearch, redis, migrate, api, storefront, edge)"

assert_replicas() {
  local service=$1 tag=$2 ids id count=0
  ids=$(compose ps -a -q "$service")
  for id in $ids; do
    count=$((count + 1))
    [[ "$(docker inspect -f '{{.State.Health.Status}}' "$id")" == healthy ]] || fail "$service replica $id is not healthy"
    [[ "$(docker inspect -f '{{.Config.Image}}' "$id")" == "${PREFIX}-${service}:${tag}" ]] || fail "$service replica $id has the wrong tag"
  done
  [[ "$count" == 2 ]] || fail "$service: $count containers, expected 2 (including stopped containers)"
}
assert_replicas api "$TAG"
assert_replicas storefront "$TAG"
pass "two healthy api and two healthy storefront replicas"

[[ "$(docker inspect -f '{{.State.ExitCode}}' "$(compose ps -a -q migrate)")" == "0" ]] || fail "migrate did not exit 0"
MIGRATE_LOG=$(compose logs --no-color migrate)
[[ "$MIGRATE_LOG" == *"0000_health_check"* ]] || fail "migrate did not apply the migrations"
pass "migrations applied by the migrate service before the API started"

# --- helpers ---
CURL=(curl -sS --noproxy "*" --cacert "$CA" --resolve "${DOMAIN}:${HTTPS_PORT}:127.0.0.1")
HEADERS="$WORK/headers.txt"
# --- search engine: the API's scoped key is made once with the master key, then search is switched on (docs/deployment.md) ---
# shellcheck disable=SC2016 # The engine container expands MEILI_MASTER_KEY.
SEARCH_KEY_JSON=$(compose exec -T meilisearch sh -c 'wget -q -O - \
  --header "Authorization: Bearer $MEILI_MASTER_KEY" --header "Content-Type: application/json" \
  --post-data "{\"description\":\"fluxkit API\",\"indexes\":[\"fluxkit_*\"],\"expiresAt\":null,\"actions\":[\"search\",\"documents.add\",\"documents.delete\",\"indexes.create\",\"indexes.delete\",\"indexes.swap\",\"settings.update\",\"settings.get\",\"tasks.get\",\"tasks.delete\",\"stats.get\"]}" \
  http://127.0.0.1:7700/keys')
SEARCH_KEY=$(jq -er .key <<<"$SEARCH_KEY_JSON") || fail "the engine did not return a scoped key"
printf 'SEARCH_ENABLED=true\nMEILI_API_KEY=%s\n' "$SEARCH_KEY" >>"$WORK/production.env"
compose up -d --no-build --no-deps --force-recreate --wait --wait-timeout 120 api >/dev/null
pass "scoped search key created through the engine container; the API restarted with search on"
[[ -z "$(compose exec -T --index 1 api printenv MEILI_MASTER_KEY 2>/dev/null || true)" ]] || fail "the api received the engine's master key"
pass "the api container does not hold the engine's master key"
# An empty catalog still builds, swaps and counts an index: this uses the scoped key for every engine call the API makes
# (exit 2 = a scheduler tick held the lock at that moment; try again).
REINDEX_STATUS=2
for _ in 1 2 3 4 5; do
  REINDEX_STATUS=0
  REINDEX_OUT=$(compose run --rm --no-deps -T api node dist/search/reindex.js 2>&1) || REINDEX_STATUS=$?
  [[ "$REINDEX_STATUS" != "2" ]] && break
  sleep 5
done
[[ "$REINDEX_STATUS" == "0" ]] || fail "search reindex exited $REINDEX_STATUS (a wrong or under-scoped key shows here as engine_unauthorized): $REINDEX_OUT"
pass "the scoped key builds and swaps the search indexes (reindex exit 0)"


BODY="$WORK/body.txt"
# request METHOD PATH [curl args...]: status in $STATUS, headers in $HEADERS (lower-case names), body in $BODY
request() {
  local method=$1 path=$2
  shift 2
  STATUS=$("${CURL[@]}" -X "$method" -o "$BODY" -D "$HEADERS" -w '%{http_code}' "$@" "${ORIGIN}${path}")
  # awk, not `sed \L` (GNU only: BSD sed on macOS writes a literal "L").
  tr -d '\r' <"$HEADERS" | awk '{ i = index($0, ":"); if (i > 0) print tolower(substr($0, 1, i)) substr($0, i + 1); else print }' >"$HEADERS.lower"
  mv "$HEADERS.lower" "$HEADERS"
}
header() { grep -i "^$1:" "$HEADERS" | head -1 | cut -d' ' -f2- || true; }
header_count() { grep -ci "^$1:" "$HEADERS" || true; }
expect_status() { [[ "$STATUS" == "$1" ]] || fail "$2: status $STATUS, expected $1"; }
expect_hsts_once() {
  [[ "$(header_count strict-transport-security)" == "1" ]] || fail "$1: Strict-Transport-Security not exactly once"
  [[ "$(header strict-transport-security)" == "max-age=31536000" ]] || fail "$1: wrong HSTS value"
}
expect_no_powered_by() { [[ "$(header_count x-powered-by)" == "0" ]] || fail "$1: X-Powered-By leaked"; }

# --- storefront ---
request GET /
expect_status 307 "GET /"
[[ "$(header location)" == "/uk" ]] || fail "GET / should redirect to /uk"
expect_hsts_once "GET /"
expect_no_powered_by "GET /"
pass "/ -> storefront redirect to /uk, one HSTS header, no X-Powered-By"

request GET /uk
expect_status 200 "GET /uk"
[[ "$(header content-type)" == text/html* ]] || fail "GET /uk is not HTML"
[[ "$(header content-security-policy)" == *"img-src 'self' data: https://${DOMAIN}"* ]] || fail "storefront CSP lacks the image host"
expect_hsts_once "GET /uk"
pass "/uk renders through the storefront (which reads the API over the internal network), CSP has the image host"

# --- API routes ---
request GET /store/config
expect_status 200 "GET /store/config"
jq -e '.currency == "UAH" and .onlinePayment == false' "$BODY" >/dev/null || fail "/store/config body"
expect_hsts_once "GET /store/config"
expect_no_powered_by "GET /store/config"
pass "/store/* -> API, one HSTS header, no X-Powered-By"

request GET /store
[[ "$(header content-type)" == application/problem+json* ]] || fail "bare /store did not reach the API"
pass "bare /store -> API"

request GET /admin/auth/me
expect_status 401 "GET /admin/auth/me"
[[ "$(header content-type)" == application/problem+json* ]] || fail "/admin/* did not reach the API"
pass "/admin/* -> API (401 problem without a session)"

request POST /webhooks/payments/monobank -H 'Content-Type: application/json' --data '{}'
expect_status 404 "POST /webhooks/payments/monobank"
[[ "$(header content-type)" == application/problem+json* ]] || fail "/webhooks/payments did not reach the API"
pass "/webhooks/payments/* -> API (404: no payment provider enabled)"

head -c 70000 /dev/zero | tr '\0' 'a' >"$WORK/big.json"
request POST /webhooks/payments/monobank -H 'Content-Type: application/json' --data-binary "@$WORK/big.json"
expect_status 413 "70 kB webhook body"
pass "/webhooks/payments refuses a body above 64k at the edge"

# Email feedback uses its own raw-byte route/limit; no provider credentials are enabled in this smoke run.
for provider in resend brevo; do
  request POST "/webhooks/email/$provider" -H 'Content-Type: application/json' --data '{}'
  expect_status 404 "POST /webhooks/email/$provider"
  [[ "$(header content-type)" == application/problem+json* ]] || fail "/webhooks/email did not reach the API"
  request POST "/webhooks/email/$provider" -H 'Content-Type: application/json' --data-binary "@$WORK/big.json"
  expect_status 413 "70 kB email webhook body"
done
pass "/webhooks/email/* -> API and refuses bodies above 64 KiB"


for path in /docs /docs-json /health; do
  request GET "$path"
  expect_status 404 "GET $path"
  grep -qi "swagger\|\"status\":\"ok\"" "$BODY" && fail "$path is public"
done
pass "/docs, /docs-json and /health are not public (404 from the storefront)"

# --- admin SPA ---
EXPECTED_ADMIN_CSP="default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data: https://${DOMAIN}; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
for path in /admin-ui /admin-ui/ /admin-ui/orders/deep/link; do
  request GET "$path"
  expect_status 200 "GET $path"
  grep -q '<div id="root">\|<script type="module"' "$BODY" || fail "$path did not serve index.html"
  [[ "$(header content-security-policy)" == "$EXPECTED_ADMIN_CSP" ]] || fail "$path CSP: $(header content-security-policy)"
  [[ "$(header cache-control)" == "no-cache" ]] || fail "$path Cache-Control"
  [[ "$(header x-frame-options)" == "DENY" ]] || fail "$path X-Frame-Options"
  [[ "$(header referrer-policy)" == "no-referrer" ]] || fail "$path Referrer-Policy"
  [[ "$(header cross-origin-opener-policy)" == "same-origin" ]] || fail "$path COOP"
  expect_hsts_once "GET $path"
done
pass "/admin-ui, /admin-ui/ and deep links serve index.html with the admin headers and HSTS"

ASSET=$(grep -o '/admin-ui/assets/[^"]*\.js' "$BODY" | head -1)
[[ -n "$ASSET" ]] || fail "no asset in index.html"
request GET "$ASSET"
expect_status 200 "GET $ASSET"
[[ "$(header cache-control)" == "public, max-age=31536000, immutable" ]] || fail "asset Cache-Control"
expect_hsts_once "GET asset"
request GET /admin-ui/assets/missing-0000.js
expect_status 404 "missing asset"
[[ "$(header cache-control)" != *immutable* ]] || fail "a missing asset is marked immutable"
pass "hashed assets are immutable; a missing asset is a 404 without the immutable header"

# --- http -> https ---
STATUS=$(curl -sS --noproxy "*" -o /dev/null -D "$HEADERS" -w '%{http_code}' "http://127.0.0.1:${HTTP_PORT}/uk/catalog?x=1")
[[ "$STATUS" == "301" ]] || fail "http redirect status $STATUS"
tr -d '\r' <"$HEADERS" >"$HEADERS.clean"
grep -qi "^location: https://${DOMAIN}/uk/catalog?x=1$" "$HEADERS.clean" || fail "http redirect target"
STATUS=$(curl -sS --noproxy "*" -o /dev/null -w '%{http_code}' "http://127.0.0.1:${HTTP_PORT}/.edge-health")
[[ "$STATUS" == "301" ]] || fail "/.edge-health must not be answered on the public port (got $STATUS)"
pass "port 80 redirects to https on the configured host; the edge health route is local only"

# --- admin owner, sign-in and an image upload through the edge (media volume, read route) ---
compose run --rm -T --no-deps -e "ADMIN_PASSWORD=${OWNER_PASSWORD}" api \
  node dist/auth/create-admin.js --email "$OWNER_EMAIL" >/dev/null
JAR="$WORK/cookies.txt"
request POST /admin/auth/login -c "$JAR" -H 'Content-Type: application/json' -H 'X-Fluxkit-CSRF: 1' \
  --data "{\"email\":\"${OWNER_EMAIL}\",\"password\":\"${OWNER_PASSWORD}\"}"
expect_status 200 "admin login"
grep -qi "^set-cookie:.*; *secure" "$HEADERS" || fail "the admin cookie is not Secure"
pass "pnpm admin:create equivalent in the image; sign-in through the edge sets a Secure cookie"

printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAGUlEQVQokWM4ISdHEmIY1SA3GkonhmvSAADkYgQQjClmVwAAAABJRU5ErkJggg==' |
  base64 -d >"$WORK/pixel.png"
request POST /admin/media/uploads -b "$JAR" -H 'Content-Type: application/octet-stream' -H 'X-Fluxkit-CSRF: 1' \
  --data-binary "@$WORK/pixel.png"
expect_status 201 "image upload"
MEDIA_URL=$(jq -r .url "$BODY")
MEDIA_FILE=${MEDIA_URL##*/}
# core/media/key.ts keyToRelativePath shards a key by its first two byte pairs.
MEDIA_PATH=${MEDIA_FILE:0:2}/${MEDIA_FILE:2:2}/$MEDIA_FILE
for index in 1 2; do
  compose exec -T --index "$index" api ls "/var/lib/fluxkit/media/$MEDIA_PATH" >/dev/null || fail "uploaded media missing from api replica $index"
done
pass "the uploaded file is visible on the shared media volume in both api replicas"
[[ "$MEDIA_URL" == "https://${DOMAIN}/media/"* ]] || fail "upload URL $MEDIA_URL"
request GET "${MEDIA_URL#https://"${DOMAIN}"}"
expect_status 200 "GET uploaded image"
[[ "$(header content-type)" == "image/png" ]] || fail "media Content-Type"
[[ "$(header cache-control)" == "public, max-age=31536000, immutable" ]] || fail "media Cache-Control"
expect_hsts_once "GET media"
request GET /media/0000000000000000000000000000dead.png
expect_status 404 "missing media"
[[ "$(header cache-control)" == "no-store" ]] || fail "missing media Cache-Control"
pass "upload through the edge is stored on the media volume and served by /media with the API's cache headers"

# --- hardening of the running containers ---
[[ "$(compose exec -T --index 1 api id -u)" == "1000" ]] || fail "api is not uid 1000"
[[ "$(compose exec -T --index 1 storefront id -u)" == "1000" ]] || fail "storefront is not uid 1000"
[[ "$(compose exec -T edge id -u)" == "101" ]] || fail "edge is not uid 101"
if compose exec -T --index 1 api node -e "require('node:fs').writeFileSync('/app/probe','x')" 2>/dev/null; then
  fail "the api root file system is writable"
fi
NGINX_TEST=$(compose exec -T edge nginx -t 2>&1) || fail "nginx -t: $NGINX_TEST"
[[ "$NGINX_TEST" == *"syntax is ok"* && "$NGINX_TEST" == *"test is successful"* ]] || fail "nginx -t: $NGINX_TEST"
pass "non-root users (1000, 1000, 101), read-only root file system, nginx -t inside the edge"

# --- per-client rate limit behind the edge (TRUST_PROXY=1, X-Forwarded-For replaced) ---
# The admin login allows 20 attempts per 10 minutes per client address. Requests from the host reach the edge from the
# Docker gateway address; a container on the Compose network is a second client with another address. The owner's
# sign-in above was this client's first attempt, so 19 more fill the window.
for attempt in $(seq 2 20); do
  request POST /admin/auth/login -H 'Content-Type: application/json' -H 'X-Fluxkit-CSRF: 1' \
    -H "X-Forwarded-For: 198.51.100.${attempt}" --data '{"email":"nobody@fluxkit.test","password":"wrong-password-0123"}'
  [[ "$STATUS" == "401" ]] || fail "login attempt $attempt: $STATUS"
done
request POST /admin/auth/login -H 'Content-Type: application/json' -H 'X-Fluxkit-CSRF: 1' \
  -H 'X-Forwarded-For: 203.0.113.250' --data '{"email":"nobody@fluxkit.test","password":"wrong-password-0123"}'
expect_status 429 "21st login from the same client with an invented X-Forwarded-For"
pass "20 then 429 through nginx round robin over two api replicas: shared login window; invented X-Forwarded-For cannot dodge it"
# LoginThrottle uses adminLogin; window-store.ts namespaces by the encoded DB name (fluxkit in this fixture).
LOGIN_KEYS=$(compose exec -T redis redis-cli --scan --pattern 'fluxkit:fluxkit:rl:adminLogin:*')
[[ "$(printf '%s\n' "$LOGIN_KEYS" | awk 'NF { n++ } END { print n+0 }')" == 1 ]] || fail "expected exactly one shared admin login key"
[[ "$(compose exec -T redis redis-cli get "$LOGIN_KEYS")" == 21 ]] || fail "shared admin login counter is not 21"
pass "Redis contains exactly one adminLogin key for this client's 21 attempts"

NETWORK="${PROJECT}_default"
OTHER_CLIENT=$(docker run --rm --network "$NETWORK" -v "$(pwd)/${WORK}/certs:/certs:ro" "${PREFIX}-api:${TAG}" node -e "
const https = require('node:https');
const body = JSON.stringify({ email: 'nobody@fluxkit.test', password: 'wrong-password-0123' });
const req = https.request({ host: 'edge', port: 8443, servername: '${DOMAIN}', path: '/admin/auth/login', method: 'POST',
  ca: require('node:fs').readFileSync('/certs/fullchain.pem'),
  headers: { host: '${DOMAIN}', 'content-type': 'application/json', 'x-fluxkit-csrf': '1', 'content-length': Buffer.byteLength(body) } },
  (res) => { console.log(res.statusCode); res.resume(); });
req.on('error', (error) => { console.log('error ' + error.code); });
req.end(body);
")
[[ "$OTHER_CLIENT" == "401" ]] || fail "a second client was limited too ($OTHER_CLIENT): the API counts the proxy, not the client"
pass "another client address keeps its own window (the API counts clients, not the edge)"

# --- catalog search through the edge (the engine is reachable only from the API) ---
request GET /store/config
expect_status 200 "GET /store/config with search on"
[[ "$(jq -r .search "$BODY")" == "true" ]] || fail "GET /store/config does not report search: true"
request GET "/store/search?q=x"
expect_status 200 "GET /store/search after the reindex"
pass "search is on and answers through the edge with the scoped key (config says so, /store/search is 200)"
ENGINE_ID=$(compose ps -q meilisearch)
[[ -n "$ENGINE_ID" ]] || fail "no meilisearch container"
[[ -z "$(docker port "$ENGINE_ID" 2>/dev/null)" ]] || fail "the search engine publishes a port"
pass "the search engine publishes no port"

# --- redis (shared state of the API instances, multi-instance plan): internal only, password, nothing persisted ---
REDIS_ID=$(compose ps -q redis)
[[ -n "$REDIS_ID" ]] || fail "no redis container"
[[ -z "$(docker port "$REDIS_ID" 2>/dev/null)" ]] || fail "redis publishes a port"
[[ "$(compose exec -T redis redis-cli ping)" == "PONG" ]] || fail "redis does not answer PING with the password"
[[ "$(compose exec -T -e REDISCLI_AUTH= redis redis-cli ping 2>&1)" == *NOAUTH* ]] || fail "redis answers without the password"
[[ "$(compose exec -T redis redis-cli config get save | sed -n 2p)" == "" ]] || fail "redis takes RDB snapshots"
[[ "$(compose exec -T redis redis-cli config get appendonly | sed -n 2p)" == "no" ]] || fail "redis writes an append-only file"
[[ "$(compose exec -T redis redis-cli config get maxmemory-policy | sed -n 2p)" == "volatile-ttl" ]] ||
  fail "redis eviction policy is not volatile-ttl"
pass "redis publishes no port, needs its password and persists nothing (no RDB, no AOF, volatile-ttl)"

# --- an optional feature switched on in the running shop (docs/deployment.md, "Optional features"; blog plan E1) ---
request GET /uk/blog
expect_status 404 "GET /uk/blog with the blog off"
request GET "/store/blog/posts?locale=uk"
expect_status 404 "GET /store/blog/posts with the blog off"
pass "the blog is off by default: /uk/blog and /store/blog/* answer 404"

printf 'FEATURES_ENABLED=blog\n' >>"$WORK/production.env"
# Started before its migration, the API refuses to start (loud, by design). Bounded without `timeout` (not on macOS).
compose run --rm --no-deps -T api node dist/main.js >"$WORK/refusal.log" 2>&1 &
REFUSAL_PID=$!
for _ in $(seq 1 60); do
  kill -0 "$REFUSAL_PID" 2>/dev/null || break
  sleep 1
done
if kill -0 "$REFUSAL_PID" 2>/dev/null; then
  kill "$REFUSAL_PID" 2>/dev/null || true
  fail "the API kept running with the blog enabled and its migration missing"
fi
if wait "$REFUSAL_PID"; then fail "the API exited 0 with the blog enabled and its migration missing"; fi
grep -qF 'Enabled features have migrations that are not applied: "blog"' "$WORK/refusal.log" ||
  fail "the API did not name the blog's missing migration: $(cat "$WORK/refusal.log")"
pass "with FEATURES_ENABLED=blog and no migration the API refuses to start, naming the feature"

FEATURE_MIGRATE_LOG=$(compose run --rm --no-deps -T migrate 2>&1) || fail "migrate with the blog: $FEATURE_MIGRATE_LOG"
[[ "$FEATURE_MIGRATE_LOG" == *'Feature "blog": applied 1 migration'* ]] || fail "migrate did not apply the blog's migration: $FEATURE_MIGRATE_LOG"
compose up -d --no-build --no-deps --force-recreate --wait --wait-timeout 120 api >/dev/null
request GET /store/config
expect_status 200 "GET /store/config with the blog on"
jq -e '.features == ["blog"]' "$BODY" >/dev/null || fail "GET /store/config features: $(jq -c .features "$BODY")"
request GET "/store/blog/posts?locale=uk"
expect_status 200 "GET /store/blog/posts with the blog on"
pass "env file, migrate step, API restart: the blog's migration ran and its store routes answer"

# The storefront was not rebuilt or restarted: its blog pages come from the slice registry generated inside the Docker build,
# and the switch reaches it through its config cache (60 s).
BLOG_PAGE_STATUS=404
for _ in $(seq 1 18); do
  request GET /uk/blog
  BLOG_PAGE_STATUS=$STATUS
  [[ "$BLOG_PAGE_STATUS" == "200" ]] && break
  sleep 5
done
[[ "$BLOG_PAGE_STATUS" == "200" ]] || fail "GET /uk/blog stayed $BLOG_PAGE_STATUS after the blog was switched on"
grep -q 'href="/uk/blog"' "$BODY" || fail "/uk/blog has no link to the blog (header or footer)"
request GET /sitemap.xml
expect_status 200 "GET /sitemap.xml with the blog on"
grep -q "<loc>https://${DOMAIN}/uk/blog</loc>" "$BODY" || fail "/sitemap.xml does not list /uk/blog"
pass "the storefront image's generated registry has the blog: /uk/blog renders with its link, the sitemap lists it"

# --- a recreated API is found again without restarting the edge (resolver + upstream resolve) ---
compose up -d --no-build --no-deps --force-recreate --wait --wait-timeout 120 api >/dev/null
request GET /store/config
expect_status 200 "GET /store/config after recreating the api"
pass "the edge reaches a recreated api container"

# An unavailable API must ask email providers to retry; payment and other upstream errors retain their status.
compose stop api >/dev/null
for provider in resend brevo; do
  request POST "/webhooks/email/$provider" -H 'Content-Type: application/json' --data '{}'
  expect_status 429 "unavailable API: email webhook"
  [[ "$(header retry-after)" == "5" ]] || fail "email outage response lacks bounded Retry-After"
done
request POST /webhooks/payments/monobank -H 'Content-Type: application/json' --data '{}'
expect_status 502 "unavailable API: payment webhook"
request GET /store/config
expect_status 502 "unavailable API: store config"
pass "API outage: only email feedback maps to 429 with Retry-After"
compose up -d --no-build --no-deps --wait --wait-timeout 120 api >/dev/null
# nginx marked both api replicas failed during the outage (fail_timeout 20 s): wait until it routes again, so the rollout
# traffic below measures the rollout, not the end of this outage.
EDGE_STATUS=000
for _ in $(seq 1 30); do
  request GET /store/config
  EDGE_STATUS=$STATUS
  [[ "$EDGE_STATUS" == "200" ]] && break
  sleep 1
done
[[ "$EDGE_STATUS" == "200" ]] || fail "the edge did not route to the restarted api ($EDGE_STATUS)"

# --- real host deployment: new image tags, same locally built images; stub backup, no registry or prune ---
command -v flock >/dev/null || fail "the host deploy check needs flock (the deploy host is Linux)"
HOST_ROOT="$(pwd)/$WORK/host"
mkdir -p "$HOST_ROOT/releases/$TAG"
# Archive the working checkout's infra (including this change), excluding the work directory itself.
tar --exclude=infra/.smoke -cf "$WORK/infra.tar" infra
tar -xf "$WORK/infra.tar" -C "$HOST_ROOT/releases/$TAG"
ln -s "$HOST_ROOT/releases/$TAG" "$HOST_ROOT/current"
cat >"$HOST_ROOT/backup" <<'SH'
#!/bin/sh
touch "${0%/*}/backup-ran"
SH
chmod +x "$HOST_ROOT/backup"

host_deploy() {
  FLUXKIT_ROOT="$HOST_ROOT" FLUXKIT_ENV_FILE="$(pwd)/$WORK/production.env" \
    FLUXKIT_MEILI_ENV_FILE="$(pwd)/$WORK/meilisearch.env" \
    FLUXKIT_DEPLOY_BACKUP="$HOST_ROOT/backup" FLUXKIT_DEPLOY_PRUNE="$HOST_ROOT/no-prune" \
    FLUXKIT_DEPLOY_LOCK="$HOST_ROOT/deploy.lock" FLUXKIT_DEPLOY_LOG_DIR="$HOST_ROOT/logs" FLUXKIT_DEPLOY_SKIP_PULL=1 \
    bash infra/deploy/fluxkit-deploy deploy "$1" <"$WORK/infra.tar"
}

request_loop() {
  local path status result sequence=0
  while [[ ! -f "$WORK/stop-requests" ]]; do
    sequence=$((sequence + 1))
    # A unique missing product forces a no-store API read; a warm home page alone can hide a failed server fetch.
    for path in /store/config /uk "/uk/p/replica-smoke-$sequence"; do
      result=0
      status=$("${CURL[@]}" --max-time 15 -o /dev/null -w '%{http_code}' "${ORIGIN}${path}" 2>>"$WORK/roll-curl.log") || result=$?
      printf '%s %s %s %s\n' "$path" "$result" "$status" "$(date +%s)" >>"$WORK/roll-requests.log"
    done
    sleep 0.2
  done
}
request_loop &
REQUEST_PID=$!
if ! host_deploy "$NEXT_TAG"; then fail "rolling deploy of the second tag failed"; fi
touch "$WORK/stop-requests"
wait "$REQUEST_PID"
REQUEST_PID=
[[ -f "$HOST_ROOT/backup-ran" ]] || fail "the successful release did not run the backup command"
assert_roll_traffic() {
  # curl 7 (refused) and 35 (TLS handshake cut off while nginx quits) are the single edge's restart: no HTTP request was
  # sent. Cold missing products must answer 404, never 5xx.
  local allow_edge_refusals=$2 counts api_ok storefront_ok cold_ok edge_refused bad
  counts=$(awk '
    $2 == 7 || $2 == 35 { refused++; next }
    $2 != 0 { bad++; next }
    $1 ~ /^\/uk\/p\/replica-smoke-/ { if ($3 == 404) cold++; else bad++; next }
    $3 != 200 { bad++; next }
    $1 == "/store/config" { api++ }
    $1 == "/uk" { storefront++ }
    END { print api+0, storefront+0, cold+0, refused+0, bad+0 }
  ' "$WORK/roll-requests.log")
  read -r api_ok storefront_ok cold_ok edge_refused bad <<<"$counts"
  if [[ "$bad" != 0 || "$api_ok" == 0 || "$storefront_ok" == 0 || "$cold_ok" == 0 ]]; then
    # Path, curl exit, HTTP status, Unix time: compare with the deploy script's phase lines above.
    echo "--- $1: requests that were not as expected ---" >&2
    awk '$2 != 0 && $2 != 7 && $2 != 35 { print; next } $1 ~ /^\/uk\/p\/replica-smoke-/ { if ($3 != 404) print; next } $3 != 200' "$WORK/roll-requests.log" >&2
    echo "--- curl errors ---" >&2
    tail -20 "$WORK/roll-curl.log" >&2 || true
    echo "--- edge errors and 5xx ---" >&2
    compose logs --no-color edge 2>&1 | grep -E '\[error\]|" 5[0-9][0-9] ' | tail -30 >&2 || true
    fail "$1 traffic: api/storefront/cold/refused/bad = $counts"
  fi
  [[ "$allow_edge_refusals" == true || "$edge_refused" == 0 ]] || fail "$1 interrupted the edge ($edge_refused refused connections)"
  # Refusals belong to one edge restart only: all within a few seconds, never spread over the application rollout.
  local refusal_span
  refusal_span=$(awk '$2 == 7 || $2 == 35 { if (min == "" || $4 < min) min = $4; if ($4 > max) max = $4 }
    END { print (min == "" ? 0 : max - min) }' "$WORK/roll-requests.log")
  [[ "$refusal_span" -le 10 ]] || fail "$1: refused or cut connections spread over ${refusal_span}s, more than one edge restart"

  pass "$1 traffic: $api_ok API 200s, $storefront_ok storefront 200s, $cold_ok cold product 404s, $edge_refused refused or cut connections (edge restart), zero 5xx or other curl failures"
}
assert_roll_traffic "successful release" true
assert_replicas api "$NEXT_TAG"
assert_replicas storefront "$NEXT_TAG"
[[ "$(readlink "$HOST_ROOT/current")" == "$HOST_ROOT/releases/$NEXT_TAG" ]] || fail "current did not switch"
pass "rolling deploy leaves exactly two healthy api and storefront containers on the new tag, no old containers"

# The migrator has its own Compose command: the broken image still migrates, then its API process exits 1.
printf 'FROM %s-api:%s\nCMD ["node", "-e", "process.exit(1)"]\n' "$PREFIX" "$TAG" >"$WORK/broken.Dockerfile"
docker build --quiet -f "$WORK/broken.Dockerfile" -t "${PREFIX}-api:${BROKEN_TAG}" "$WORK" >/dev/null
for target in storefront edge; do
  docker tag "${PREFIX}-${target}:${TAG}" "${PREFIX}-${target}:${BROKEN_TAG}"
done
PREVIOUS_API_IDS=$(compose ps -q api | sort)
mv "$WORK/roll-requests.log" "$WORK/successful-roll-requests.log"
rm "$WORK/stop-requests"
request_loop &
REQUEST_PID=$!
BROKEN_STATUS=0
host_deploy "$BROKEN_TAG" >"$WORK/broken-deploy.out" 2>&1 || BROKEN_STATUS=$?
[[ "$BROKEN_STATUS" == 1 ]] || fail "the broken API release returned $BROKEN_STATUS instead of 1"
touch "$WORK/stop-requests"
wait "$REQUEST_PID"
REQUEST_PID=
if grep -qv '^fluxkit deploy: ' "$WORK/broken-deploy.out"; then fail "the client received detailed deployment output"; fi
BROKEN_LOG=$(sed -n 's/^fluxkit deploy: detailed log: //p' "$WORK/broken-deploy.out")
[[ "$BROKEN_LOG" == "$HOST_ROOT/logs/"*.log && -f "$BROKEN_LOG" ]] || fail "the client did not name the detailed log"
[[ "$(stat -c %a "$HOST_ROOT/logs") $(stat -c %a "$BROKEN_LOG") $(stat -c %a "$BROKEN_LOG.summary")" == "700 600 600" ]] ||
  fail "the deploy log directory or files are not private"
grep -Eq '^(api|migrate)-[0-9]+[[:space:]]*\|' "$BROKEN_LOG" || fail "container output is missing from the detailed log"
cat "$WORK/broken-deploy.out"
assert_roll_traffic "failed release" false
[[ "$(compose ps -q api | sort)" == "$PREVIOUS_API_IDS" ]] || fail "rollback recreated the old serving api replicas"
assert_replicas api "$NEXT_TAG"
assert_replicas storefront "$NEXT_TAG"
grep -qx "FLUXKIT_IMAGE_TAG=$NEXT_TAG" "$WORK/production.env" || fail "rollback did not restore the env tag"
[[ "$(readlink "$HOST_ROOT/current")" == "$HOST_ROOT/releases/$NEXT_TAG" ]] || fail "rollback did not restore current"
request GET /store/config
expect_status 200 "GET /store/config after the failed release"
pass "broken release fails, removes new replicas, preserves both serving old api containers and restores env/current"

# Reuse the first image tag and leave the output pipe after the first worker status line.
(set +o pipefail; host_deploy "$TAG" | head -n 1) >"$WORK/disconnected-deploy.out"
DISCONNECTED_LOG=$(sed -n 's/^fluxkit deploy: detailed log: //p' "$WORK/disconnected-deploy.out")
[[ "$DISCONNECTED_LOG" == "$HOST_ROOT/logs/"*.log ]] || fail "the disconnect test did not reach the worker"
flock -w 600 "$HOST_ROOT/deploy.lock" true || fail "the disconnected deployment did not release the lock"
grep -qx 0 "$DISCONNECTED_LOG.status" || fail "the disconnected deployment did not succeed"
grep -qx "FLUXKIT_IMAGE_TAG=$TAG" "$WORK/production.env" || fail "the disconnected deployment did not switch the env tag"
[[ "$(readlink "$HOST_ROOT/current")" == "$HOST_ROOT/releases/$TAG" ]] || fail "the disconnected deployment did not switch current"
assert_replicas api "$TAG"
assert_replicas storefront "$TAG"
request GET /store/config
expect_status 200 "GET /store/config after the disconnected release"
request GET /uk
expect_status 200 "GET /uk after the disconnected release"
pass "the worker completes the release and both applications serve after the client disconnects"

echo "deploy smoke test passed"
