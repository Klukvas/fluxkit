#!/usr/bin/env bash
# Smoke test of the production example (docs/deployment.md): builds the three images, starts
# infra/docker-compose.prod.yml under its own project name with a throwaway env file and a self-signed certificate,
# checks routing, headers, TLS, the webhook route, the media volume, the read-only file systems and the per-client rate
# limit through the edge, then removes the project and its volumes.
#
# Usage: bash scripts/deploy-smoke.sh [--keep]     (--keep leaves the stack running for a look; remove it with the
#                                                  `docker compose ... down -v` line the script prints)
# Needs: docker with Compose and BuildKit, openssl, curl, jq. Ports 18080 and 18443 on 127.0.0.1 must be free.
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
TAG=smoke
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

cat >"$WORK/production.env" <<EOF
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
ORDER_TOKEN_SECRET=$(openssl rand -hex 32)
TRUST_PROXY=1
STOREFRONT_IMAGE_HOSTS=${DOMAIN}
STOREFRONT_FORWARD_CLIENT_ADDRESS=true
EOF
# The engine's master key is in its own file: the api never receives it (docs/deployment.md).
printf 'MEILI_MASTER_KEY=%s\n' "$(openssl rand -hex 24)" >"$WORK/meilisearch.env"
trap cleanup EXIT

# --- images ---
read -r -a EXTRA_BUILD_ARGS <<<"${SMOKE_BUILD_ARGS:-}"
for target in api storefront edge; do
  echo "building $target"
  # ${arr[@]+...}: bash 3.2 (macOS) treats an empty array as unset under `set -u`.
  docker build --quiet ${EXTRA_BUILD_ARGS[@]+"${EXTRA_BUILD_ARGS[@]}"} --target "$target" \
    --build-arg "STOREFRONT_IMAGE_HOSTS=${DOMAIN}" -t "${PREFIX}-${target}:${TAG}" . >/dev/null
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
[[ "$NEST_RESOLUTION" == *"nest providers/nova-post"* && "$NEST_RESOLUTION" == *"nest features/blog"* ]] ||
  fail "the Nest check found no provider or feature packages in the API image: $NEST_RESOLUTION"
pass "every provider and feature package resolves the API's @nestjs/common ($(tr '\n' ' ' <<<"$NEST_RESOLUTION"))"

compose config --quiet
compose up -d --no-build --wait --wait-timeout 180
pass "stack healthy (postgres, meilisearch, migrate, api, storefront, edge)"

[[ "$(docker inspect -f '{{.State.ExitCode}}' "$(compose ps -a -q migrate)")" == "0" ]] || fail "migrate did not exit 0"
MIGRATE_LOG=$(compose logs --no-color migrate)
[[ "$MIGRATE_LOG" == *"0000_health_check"* ]] || fail "migrate did not apply the migrations"
pass "migrations applied by the migrate service before the API started"

# --- helpers ---
CURL=(curl -sS --noproxy "*" --cacert "$CA" --resolve "${DOMAIN}:${HTTPS_PORT}:127.0.0.1")
HEADERS="$WORK/headers.txt"
# --- search engine: the API's scoped key is made once with the master key, then search is switched on (docs/deployment.md) ---
SEARCH_KEY_JSON=$(compose exec -T meilisearch sh -c 'wget -q -O - \
  --header "Authorization: Bearer $MEILI_MASTER_KEY" --header "Content-Type: application/json" \
  --post-data "{\"description\":\"fluxkit API\",\"indexes\":[\"fluxkit_*\"],\"expiresAt\":null,\"actions\":[\"search\",\"documents.add\",\"documents.delete\",\"indexes.create\",\"indexes.delete\",\"indexes.swap\",\"settings.update\",\"settings.get\",\"tasks.get\",\"tasks.delete\",\"stats.get\"]}" \
  http://127.0.0.1:7700/keys')
SEARCH_KEY=$(jq -er .key <<<"$SEARCH_KEY_JSON") || fail "the engine did not return a scoped key"
printf 'SEARCH_ENABLED=true\nMEILI_API_KEY=%s\n' "$SEARCH_KEY" >>"$WORK/production.env"
compose up -d --no-build --no-deps --force-recreate --wait --wait-timeout 120 api >/dev/null
pass "scoped search key created through the engine container; the API restarted with search on"
[[ -z "$(compose exec -T api printenv MEILI_MASTER_KEY 2>/dev/null || true)" ]] || fail "the api received the engine's master key"
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
[[ "$REINDEX_STATUS" == "0" ]] || fail "search reindex exited $REINDEX_STATUS (a wrong or under-scoped key shows here as engine_unauthorized)"
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
[[ "$MEDIA_URL" == "https://${DOMAIN}/media/"* ]] || fail "upload URL $MEDIA_URL"
request GET "${MEDIA_URL#https://${DOMAIN}}"
expect_status 200 "GET uploaded image"
[[ "$(header content-type)" == "image/png" ]] || fail "media Content-Type"
[[ "$(header cache-control)" == "public, max-age=31536000, immutable" ]] || fail "media Cache-Control"
expect_hsts_once "GET media"
request GET /media/0000000000000000000000000000dead.png
expect_status 404 "missing media"
[[ "$(header cache-control)" == "no-store" ]] || fail "missing media Cache-Control"
pass "upload through the edge is stored on the media volume and served by /media with the API's cache headers"

# --- hardening of the running containers ---
[[ "$(compose exec -T api id -u)" == "1000" ]] || fail "api is not uid 1000"
[[ "$(compose exec -T storefront id -u)" == "1000" ]] || fail "storefront is not uid 1000"
[[ "$(compose exec -T edge id -u)" == "101" ]] || fail "edge is not uid 101"
if compose exec -T api node -e "require('node:fs').writeFileSync('/app/probe','x')" 2>/dev/null; then
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
pass "a client cannot dodge the limit with its own X-Forwarded-For (the edge replaces it)"

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

echo "deploy smoke test passed"
