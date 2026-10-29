#!/usr/bin/env bash
# Feature and provider matrix (AGENTS.md section 18).
# Usage: scripts/feature-matrix.sh on|off|deleted|providers-on|providers-off|providers-deleted|providers-nova-post|providers-email-fake|providers-email-none|providers-email-resend|providers-payment-fake|providers-payment-none|providers-payment-monobank|search-on|search-off
#   on      build, start the API with FEATURES_ENABLED=example, expect /health and /example/ping
#   off     build, start the API with no features, expect /health and 404 on /example/ping
#   deleted remove packages/features/_example, reinstall, then lint, typecheck, boundaries and tests must pass (destructive: CI only)
# The provider modes do the same for the test-only shipping provider packages/providers/_fake (ADR 0029 decision 8). Their
# observable is the line the provider registry logs at startup, "Shipping providers loaded: <codes|none>": it needs no route
# and so no new public contract.
#   providers-on      build, start the API with SHIPPING_PROVIDERS_ENABLED=fake, expect the log line to name fake
#   providers-off     build, start the API with no providers, expect "none" and no mention of fake
#   providers-deleted remove packages/providers/_fake, _fake-email, _fake-payment, nova-post, resend and monobank, reinstall,
#                     then lint, typecheck, boundaries and tests must pass, and an API told to load fake or nova_post
#                     (shipping), or started with EMAIL_PROVIDER=fake or EMAIL_PROVIDER=resend, or with
#                     PAYMENT_PROVIDERS_ENABLED=fake or PAYMENT_PROVIDERS_ENABLED=monobank, must refuse to start, loudly
#                     (destructive: CI only)
#   providers-nova-post build; an API with SHIPPING_PROVIDERS_ENABLED=nova_post and no NOVA_POST_API_KEY must refuse to
#                     start naming the variable; with an invented key it must start and report nova_post, never print the
#                     key, and send nothing to Nova Post at startup (the JWT is fetched on first use): the API runs with a
#                     preloaded fetch wrapper that logs and refuses any request to a Nova Post host, and the log must show
#                     the wrapper active and no such request
# The email provider (ADR 0031 decision 4) has the same kind of observable, "Email provider loaded: <code|none>", and the
# public flag `emailDelivery` of GET /store/config:
#   providers-email-none start the API without EMAIL_PROVIDER (none), expect "none", emailDelivery false and no mention of fake
#   providers-email-fake start the API with EMAIL_PROVIDER=fake (and EMAIL_FROM, STOREFRONT_PUBLIC_URL), expect "fake" and
#                     emailDelivery true
#   providers-email-resend build; an API with EMAIL_PROVIDER=resend and no RESEND_API_KEY must refuse to start naming the
#                     variable; with an invented key it must start, report resend and emailDelivery true, never print the
#                     key, and send nothing to Resend at startup: the API runs with a preloaded fetch wrapper that logs and
#                     refuses any request to a *.resend.com host, and the log must show the wrapper active and no such
#                     request (run it on a database without queued mail: job 9 would otherwise try to send it)
# The payment providers (ADR 0032 decision 3) have the observable "Payment providers loaded: <codes|none>" and the public flag
# `onlinePayment` of GET /store/config (true when any provider is enabled):
#   providers-payment-none start the API without PAYMENT_PROVIDERS_ENABLED, expect "none", onlinePayment false and no
#                     mention of fake
#   providers-payment-fake start the API with PAYMENT_PROVIDERS_ENABLED=fake, expect "fake" and onlinePayment true
#   providers-payment-monobank build; an API with PAYMENT_PROVIDERS_ENABLED=monobank and no MONOBANK_TOKEN must refuse to
#                     start naming the variable; with an invented token it must start, report monobank and onlinePayment
#                     true, never print the token, and send nothing to Monobank at startup (the webhook key is fetched on
#                     the first webhook): the API runs with a preloaded fetch wrapper that logs and refuses any request to
#                     a *.monobank.ua host, and the log must show the wrapper active and no such request
# Catalog search (ADR 0034) has the observable "Search: <disabled|enabled (<prefix>)>" and the public flag `search` of
# GET /store/config:
#   search-off   migrate and seed with SEARCH_ENABLED=false, start the API the same way: expect "Search: disabled",
#                search false, 404 on every search route (store and admin), and not one row written to the search tables
#                by the seed's catalog writes or the scheduler's first tick (no DB side effects)
#   search-on    start the API with SEARCH_ENABLED=true, an engine that is NOT reachable and an invented key: it must start
#                (no engine call at startup), report "Search: enabled (<prefix>)", search true, and never print the key.
#                Then, against the real engine (MEILI_URL, MEILI_MASTER_KEY): create a key scoped to a fresh prefix,
#                migrate and seed (the catalog writes mark products in the queue), `search:reindex` (builds, swaps,
#                drains the queue), start the API and find a seeded product with GET /store/search and its suggest.
#                The key and the prefix's indexes are deleted at the end.
set -euo pipefail

mode="${1:?usage: scripts/feature-matrix.sh on|off|deleted|providers-on|providers-off|providers-deleted|providers-nova-post|providers-email-fake|providers-email-none|providers-email-resend|providers-payment-fake|providers-payment-none|providers-payment-monobank|search-on|search-off}"
: "${DATABASE_URL:?DATABASE_URL must be set}"
port="${MATRIX_PORT:-3999}"
# The API refuses to start without it (ADR 0023); this one is throwaway and only lives in the process started below.
export ORDER_TOKEN_SECRET="${ORDER_TOKEN_SECRET:-feature-matrix-throwaway-secret-0123456789}"

# Rows in the three search tables of migration 0010 (queue, index state, synonyms), read with the API package's pg.
search_rows() {
  pnpm --silent --filter @fluxkit/api exec node --input-type=module -e '
import pg from "pg";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const { rows } = await client.query(
  "select (select count(*) from search_sync_queue)::int as queue, (select count(*) from search_index_state)::int as state, (select count(*) from search_synonym_group)::int as synonyms",
);
console.log(`queue=${rows[0].queue} state=${rows[0].state} synonyms=${rows[0].synonyms}`);
await client.end();
' | tail -n 1
}

# Calls the engine with the master key: meili_master <method> <path> [json body]; prints the answer.
meili_master() {
  : "${MEILI_URL:?MEILI_URL must be set}" "${MEILI_MASTER_KEY:?MEILI_MASTER_KEY must be set}"
  curl -fsS -X "$1" "${MEILI_URL}$2" -H "Authorization: Bearer ${MEILI_MASTER_KEY}" \
    -H "Content-Type: application/json" ${3:+-d "$3"}
}

stop_api() {
  kill "$api_pid" 2>/dev/null || true
  wait "$api_pid" 2>/dev/null || true
}

run_api() {
  local features="$1"
  local providers="${2:-}"
  # EMAIL_FROM and STOREFRONT_PUBLIC_URL are only read with a provider; a mode that needs them sets them for the call.
  local email="${3:-none}"
  # PAYMENT_PROVIDERS_ENABLED is set for every call (empty means none), so a value in the caller's shell never leaks in.
  local payments="${4:-}"
  pnpm build
  # MATRIX_NODE_IMPORT: an optional module preloaded into the API process only (not into the build).
  # SEARCH_ENABLED is set for every call too (MATRIX_SEARCH_ENABLED, default false); the search modes set the MEILI_* values.
  FEATURES_ENABLED="$features" SHIPPING_PROVIDERS_ENABLED="$providers" EMAIL_PROVIDER="$email" \
    PAYMENT_PROVIDERS_ENABLED="$payments" SEARCH_ENABLED="${MATRIX_SEARCH_ENABLED:-false}" PORT="$port" \
    node ${MATRIX_NODE_IMPORT:+--import "$MATRIX_NODE_IMPORT"} apps/api/dist/main.js > /tmp/fluxkit-matrix-api.log 2>&1 &
  api_pid=$!
  trap 'kill "$api_pid" 2>/dev/null || true' EXIT
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${port}/health" > /dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "API did not become healthy; log:" >&2
  cat /tmp/fluxkit-matrix-api.log >&2
  exit 1
}

case "$mode" in
  on)
    run_api "example"
    body="$(curl -fsS "http://127.0.0.1:${port}/example/ping")"
    echo "example/ping -> $body"
    echo "$body" | grep -q '"feature":"example"' || { echo "expected the example feature route" >&2; exit 1; }
    ;;
  off)
    run_api ""
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${port}/example/ping")"
    echo "example/ping -> HTTP $code"
    [ "$code" = "404" ] || { echo "expected 404 with the feature disabled" >&2; exit 1; }
    ;;
  deleted)
    [ "${CI:-}" = "true" ] || { echo "refusing to delete files outside CI (set CI=true on a throwaway copy)" >&2; exit 1; }
    rm -rf packages/features/_example
    pnpm install --no-frozen-lockfile
    pnpm lint
    pnpm typecheck
    pnpm check:boundaries
    pnpm test
    ;;
  providers-on)
    run_api "" "fake"
    grep -F "Shipping providers loaded: fake" /tmp/fluxkit-matrix-api.log \
      || { echo "expected the registry to report the fake provider" >&2; cat /tmp/fluxkit-matrix-api.log >&2; exit 1; }
    ;;
  providers-off)
    run_api "" ""
    grep -F "Shipping providers loaded: none" /tmp/fluxkit-matrix-api.log \
      || { echo "expected the registry to report no provider" >&2; cat /tmp/fluxkit-matrix-api.log >&2; exit 1; }
    ! grep -qi "fake" /tmp/fluxkit-matrix-api.log \
      || { echo "the fake provider must leave no trace when it is not enabled" >&2; cat /tmp/fluxkit-matrix-api.log >&2; exit 1; }
    ;;
  providers-deleted)
    [ "${CI:-}" = "true" ] || { echo "refusing to delete files outside CI (set CI=true on a throwaway copy)" >&2; exit 1; }
    rm -rf packages/providers/_fake packages/providers/_fake-email packages/providers/_fake-payment packages/providers/nova-post packages/providers/resend packages/providers/monobank
    pnpm install --no-frozen-lockfile
    pnpm lint
    pnpm typecheck
    pnpm check:boundaries
    pnpm test
    # A provider that is enabled but gone must stop the startup, not be skipped. The check runs before any connection.
    for code in fake nova_post; do
      if SHIPPING_PROVIDERS_ENABLED="$code" NOVA_POST_API_KEY=matrix-invented-key-0000000000000000 PORT="$port" \
        timeout 60 node apps/api/dist/main.js > /tmp/fluxkit-matrix-api.log 2>&1; then
        echo "the API started although the enabled $code provider is deleted" >&2
        exit 1
      fi
      grep -F "Shipping provider \"$code\" is enabled" /tmp/fluxkit-matrix-api.log \
        || { echo "expected a loud startup error naming the missing provider $code" >&2; cat /tmp/fluxkit-matrix-api.log >&2; exit 1; }
    done
    # The same for the email providers: the one EMAIL_PROVIDER names is gone.
    for code in fake resend; do
      if EMAIL_PROVIDER="$code" EMAIL_FROM="Fluxkit Demo Shop <shop@mail.example>" STOREFRONT_PUBLIC_URL=http://127.0.0.1:3001 \
        RESEND_API_KEY=re_matrix_invented_key_0000000000 PORT="$port" \
        timeout 60 node apps/api/dist/main.js > /tmp/fluxkit-matrix-api.log 2>&1; then
        echo "the API started although the selected email provider $code is deleted" >&2
        exit 1
      fi
      grep -F "Email provider \"$code\" is enabled in EMAIL_PROVIDER" /tmp/fluxkit-matrix-api.log \
        || { echo "expected a loud startup error naming the missing email provider $code" >&2; cat /tmp/fluxkit-matrix-api.log >&2; exit 1; }
    done
    # And for the payment providers: an enabled one that is gone stops the startup.
    for code in fake monobank; do
      if PAYMENT_PROVIDERS_ENABLED="$code" MONOBANK_TOKEN=matrix-invented-monobank-token-0000000000 PORT="$port" \
        timeout 60 node apps/api/dist/main.js > /tmp/fluxkit-matrix-api.log 2>&1; then
        echo "the API started although the enabled payment provider $code is deleted" >&2
        exit 1
      fi
      grep -F "Payment provider \"$code\" is enabled in PAYMENT_PROVIDERS_ENABLED" /tmp/fluxkit-matrix-api.log \
        || { echo "expected a loud startup error naming the missing payment provider $code" >&2; cat /tmp/fluxkit-matrix-api.log >&2; exit 1; }
    done
    ;;
  providers-nova-post)
    pnpm build
    # Without the key: a loud refusal that names the variable, before anything listens.
    if env -u NOVA_POST_API_KEY SHIPPING_PROVIDERS_ENABLED=nova_post PORT="$port" \
      timeout 60 node apps/api/dist/main.js > /tmp/fluxkit-matrix-api.log 2>&1; then
      echo "the API started with nova_post enabled and no NOVA_POST_API_KEY" >&2
      exit 1
    fi
    grep -F "NOVA_POST_API_KEY is required" /tmp/fluxkit-matrix-api.log \
      || { echo "expected a startup error naming NOVA_POST_API_KEY" >&2; cat /tmp/fluxkit-matrix-api.log >&2; exit 1; }
    # With an invented key: it starts, reports nova_post and the sandbox, never prints the key. No call is made at startup:
    # a preloaded wrapper of fetch (the plugin's only way to the network) logs and refuses any request to a Nova Post host.
    guard_dir="$(mktemp -d)"
    cat > "$guard_dir/no-nova-post.mjs" <<'GUARD'
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const host = new URL(url).hostname;
  if (host.endsWith("novapost.com")) {
    console.log(`matrix-guard: refused a request to ${host}`);
    return Promise.reject(new TypeError("matrix-guard: no Nova Post request at startup"));
  }
  return realFetch(input, init);
};
console.log("matrix-guard: active");
GUARD
    invented_key="matrix-invented-key-$(date +%s)-0000000000"
    NOVA_POST_API_KEY="$invented_key" MATRIX_NODE_IMPORT="$guard_dir/no-nova-post.mjs" run_api "" "nova_post"
    # Give anything started in the background at boot a moment to run before the log is read.
    sleep 3
    grep -F "Shipping providers loaded: nova_post" /tmp/fluxkit-matrix-api.log \
      || { echo "expected the registry to report nova_post" >&2; cat /tmp/fluxkit-matrix-api.log >&2; exit 1; }
    grep -F "Nova Post environment: sandbox" /tmp/fluxkit-matrix-api.log \
      || { echo "expected the sandbox environment by default" >&2; cat /tmp/fluxkit-matrix-api.log >&2; exit 1; }
    ! grep -qF "$invented_key" /tmp/fluxkit-matrix-api.log \
      || { echo "the API log contains the Nova Post key" >&2; exit 1; }
    grep -F "matrix-guard: active" /tmp/fluxkit-matrix-api.log \
      || { echo "the fetch wrapper was not loaded into the API" >&2; cat /tmp/fluxkit-matrix-api.log >&2; exit 1; }
    ! grep -F "matrix-guard: refused" /tmp/fluxkit-matrix-api.log \
      || { echo "the API sent a request to Nova Post at startup" >&2; exit 1; }
    rm -rf "$guard_dir"
    ;;
  providers-email-none)
    run_api "" "" "none"
    grep -F "Email provider loaded: none" /tmp/fluxkit-matrix-api.log \
      || { echo "expected the email registry to report no provider" >&2; cat /tmp/fluxkit-matrix-api.log >&2; exit 1; }
    ! grep -qi "fake" /tmp/fluxkit-matrix-api.log \
      || { echo "the fake email provider must leave no trace when EMAIL_PROVIDER is none" >&2; cat /tmp/fluxkit-matrix-api.log >&2; exit 1; }
    config="$(curl -fsS "http://127.0.0.1:${port}/store/config")"
    echo "store/config -> $config"
    echo "$config" | grep -q '"emailDelivery":false' || { echo "expected emailDelivery false with no email provider" >&2; exit 1; }
    ;;
  providers-email-fake)
    EMAIL_FROM="Fluxkit Demo Shop <shop@mail.example>" STOREFRONT_PUBLIC_URL=http://127.0.0.1:3001 run_api "" "" "fake"
    grep -F "Email provider loaded: fake" /tmp/fluxkit-matrix-api.log \
      || { echo "expected the email registry to report the fake provider" >&2; cat /tmp/fluxkit-matrix-api.log >&2; exit 1; }
    config="$(curl -fsS "http://127.0.0.1:${port}/store/config")"
    echo "store/config -> $config"
    echo "$config" | grep -q '"emailDelivery":true' || { echo "expected emailDelivery true with the email provider loaded" >&2; exit 1; }
    ;;
  providers-email-resend)
    pnpm build
    # Without the key: a loud refusal that names the variable, before anything listens.
    if env -u RESEND_API_KEY EMAIL_PROVIDER=resend EMAIL_FROM="Fluxkit Demo Shop <shop@mail.example>" \
      STOREFRONT_PUBLIC_URL=http://127.0.0.1:3001 PORT="$port" \
      timeout 60 node apps/api/dist/main.js > /tmp/fluxkit-matrix-api.log 2>&1; then
      echo "the API started with EMAIL_PROVIDER=resend and no RESEND_API_KEY" >&2
      exit 1
    fi
    grep -F "RESEND_API_KEY is required when EMAIL_PROVIDER=resend" /tmp/fluxkit-matrix-api.log \
      || { echo "expected a startup error naming RESEND_API_KEY" >&2; cat /tmp/fluxkit-matrix-api.log >&2; exit 1; }
    # With an invented key: it starts, reports resend, never prints the key. No call is made at startup: a preloaded
    # wrapper of fetch (the plugin's only way to the network) logs and refuses any request to a Resend host.
    guard_dir="$(mktemp -d)"
    cat > "$guard_dir/no-resend.mjs" <<'GUARD'
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const host = new URL(url).hostname;
  if (host === "resend.com" || host.endsWith(".resend.com")) {
    console.log(`matrix-guard: refused a request to ${host}`);
    return Promise.reject(new TypeError("matrix-guard: no Resend request at startup"));
  }
  return realFetch(input, init);
};
console.log("matrix-guard: active");
GUARD
    invented_key="re_matrix_invented_$(date +%s)_0000000000"
    RESEND_API_KEY="$invented_key" EMAIL_FROM="Fluxkit Demo Shop <shop@mail.example>" \
      STOREFRONT_PUBLIC_URL=http://127.0.0.1:3001 MATRIX_NODE_IMPORT="$guard_dir/no-resend.mjs" run_api "" "" "resend"
    # Give anything started in the background at boot (the scheduler's first tick) a moment to run.
    sleep 3
    grep -F "Email provider loaded: resend" /tmp/fluxkit-matrix-api.log \
      || { echo "expected the email registry to report resend" >&2; cat /tmp/fluxkit-matrix-api.log >&2; exit 1; }
    config="$(curl -fsS "http://127.0.0.1:${port}/store/config")"
    echo "store/config -> $config"
    echo "$config" | grep -q '"emailDelivery":true' || { echo "expected emailDelivery true with resend loaded" >&2; exit 1; }
    ! grep -qF "$invented_key" /tmp/fluxkit-matrix-api.log \
      || { echo "the API log contains the Resend key" >&2; exit 1; }
    grep -F "matrix-guard: active" /tmp/fluxkit-matrix-api.log \
      || { echo "the fetch wrapper was not loaded into the API" >&2; cat /tmp/fluxkit-matrix-api.log >&2; exit 1; }
    ! grep -F "matrix-guard: refused" /tmp/fluxkit-matrix-api.log \
      || { echo "the API sent a request to Resend at startup" >&2; exit 1; }
    rm -rf "$guard_dir"
    ;;
  providers-payment-none)
    run_api "" "" "none" ""
    grep -F "Payment providers loaded: none" /tmp/fluxkit-matrix-api.log \
      || { echo "expected the payment registry to report no provider" >&2; cat /tmp/fluxkit-matrix-api.log >&2; exit 1; }
    ! grep -qi "fake" /tmp/fluxkit-matrix-api.log \
      || { echo "the fake payment provider must leave no trace when PAYMENT_PROVIDERS_ENABLED is empty" >&2; cat /tmp/fluxkit-matrix-api.log >&2; exit 1; }
    config="$(curl -fsS "http://127.0.0.1:${port}/store/config")"
    echo "store/config -> $config"
    echo "$config" | grep -q '"onlinePayment":false' || { echo "expected onlinePayment false with no payment provider" >&2; exit 1; }
    ;;
  providers-payment-fake)
    run_api "" "" "none" "fake"
    grep -F "Payment providers loaded: fake" /tmp/fluxkit-matrix-api.log \
      || { echo "expected the payment registry to report the fake provider" >&2; cat /tmp/fluxkit-matrix-api.log >&2; exit 1; }
    config="$(curl -fsS "http://127.0.0.1:${port}/store/config")"
    echo "store/config -> $config"
    echo "$config" | grep -q '"onlinePayment":true' || { echo "expected onlinePayment true with the payment provider loaded" >&2; exit 1; }
    ;;
  providers-payment-monobank)
    pnpm build
    # Without the token: a loud refusal that names the variable, before anything listens.
    if env -u MONOBANK_TOKEN PAYMENT_PROVIDERS_ENABLED=monobank STOREFRONT_PUBLIC_URL=http://127.0.0.1:3001 PORT="$port" \
      timeout 60 node apps/api/dist/main.js > /tmp/fluxkit-matrix-api.log 2>&1; then
      echo "the API started with PAYMENT_PROVIDERS_ENABLED=monobank and no MONOBANK_TOKEN" >&2
      exit 1
    fi
    grep -F "MONOBANK_TOKEN is required when monobank is in PAYMENT_PROVIDERS_ENABLED" /tmp/fluxkit-matrix-api.log \
      || { echo "expected a startup error naming MONOBANK_TOKEN" >&2; cat /tmp/fluxkit-matrix-api.log >&2; exit 1; }
    # With an invented token: it starts, reports monobank, never prints the token. No call is made at startup: a preloaded
    # wrapper of fetch (the plugin's only way to the network) logs and refuses any request to a Monobank host.
    guard_dir="$(mktemp -d)"
    cat > "$guard_dir/no-monobank.mjs" <<'GUARD'
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const host = new URL(url).hostname;
  if (host === "monobank.ua" || host.endsWith(".monobank.ua")) {
    console.log(`matrix-guard: refused a request to ${host}`);
    return Promise.reject(new TypeError("matrix-guard: no Monobank request at startup"));
  }
  return realFetch(input, init);
};
console.log("matrix-guard: active");
GUARD
    invented_token="matrix-invented-monobank-$(date +%s)-0000000000"
    MONOBANK_TOKEN="$invented_token" STOREFRONT_PUBLIC_URL=http://127.0.0.1:3001 \
      MATRIX_NODE_IMPORT="$guard_dir/no-monobank.mjs" run_api "" "" "none" "monobank"
    # Give anything started in the background at boot (the scheduler's first tick) a moment to run.
    sleep 3
    grep -F "Payment providers loaded: monobank" /tmp/fluxkit-matrix-api.log \
      || { echo "expected the payment registry to report monobank" >&2; cat /tmp/fluxkit-matrix-api.log >&2; exit 1; }
    config="$(curl -fsS "http://127.0.0.1:${port}/store/config")"
    echo "store/config -> $config"
    echo "$config" | grep -q '"onlinePayment":true' || { echo "expected onlinePayment true with monobank loaded" >&2; exit 1; }
    ! grep -qF "$invented_token" /tmp/fluxkit-matrix-api.log \
      || { echo "the API log contains the Monobank token" >&2; exit 1; }
    grep -F "matrix-guard: active" /tmp/fluxkit-matrix-api.log \
      || { echo "the fetch wrapper was not loaded into the API" >&2; cat /tmp/fluxkit-matrix-api.log >&2; exit 1; }
    ! grep -F "matrix-guard: refused" /tmp/fluxkit-matrix-api.log \
      || { echo "the API sent a request to Monobank at startup" >&2; exit 1; }
    rm -rf "$guard_dir"
    ;;
  search-off)
    # The commands run from the built output without the root .env (like run_api): only the variables set here count.
    pnpm build
    node apps/api/dist/database/migrate.js
    before="$(search_rows)"
    echo "search tables before: $before"
    # The seed writes the demo catalog through the same services as the admin API (marks would happen here).
    SEARCH_ENABLED=false node apps/api/dist/seed/seed.js
    MATRIX_SEARCH_ENABLED=false run_api "" "" "none" ""
    grep -F "Search: disabled" /tmp/fluxkit-matrix-api.log \
      || { echo "expected the search module to report disabled" >&2; cat /tmp/fluxkit-matrix-api.log >&2; exit 1; }
    config="$(curl -fsS "http://127.0.0.1:${port}/store/config")"
    echo "store/config -> $config"
    echo "$config" | grep -q '"search":false' || { echo "expected search false with SEARCH_ENABLED=false" >&2; exit 1; }
    for path in "/store/search?q=shirt" "/store/search/suggest?q=sh" "/admin/search/status" "/admin/search/synonyms"; do
      code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${port}${path}")"
      echo "$path -> HTTP $code"
      [ "$code" = "404" ] || { echo "expected 404 on $path with search off" >&2; exit 1; }
    done
    # Give the scheduler's first tick (jobs 13 and 14 included) a moment to run.
    sleep 3
    after="$(search_rows)"
    echo "search tables after seed and API: $after"
    [ "$after" = "$before" ] || { echo "search off must not write the search tables ($before -> $after)" >&2; exit 1; }
    ;;
  search-on)
    # An engine address nothing listens on and an invented key: the API must start without calling the engine.
    invented_key="matrix-invented-search-key-$(date +%s)"
    MEILI_URL=http://127.0.0.1:9 MEILI_API_KEY="$invented_key" MEILI_INDEX_PREFIX=matrix_ \
      MATRIX_SEARCH_ENABLED=true run_api "" "" "none" ""
    grep -F "Search: enabled (matrix_)" /tmp/fluxkit-matrix-api.log \
      || { echo "expected the search module to report enabled" >&2; cat /tmp/fluxkit-matrix-api.log >&2; exit 1; }
    config="$(curl -fsS "http://127.0.0.1:${port}/store/config")"
    echo "store/config -> $config"
    echo "$config" | grep -q '"search":true' || { echo "expected search true with SEARCH_ENABLED=true" >&2; exit 1; }
    ! grep -qF "$invented_key" /tmp/fluxkit-matrix-api.log \
      || { echo "the API log contains the search key" >&2; exit 1; }
    stop_api

    # The real engine: a key scoped to a fresh prefix, as an operator creates it (README, Catalog search).
    prefix="matrix$(date +%s)_"
    key_json="$(meili_master POST /keys "{\"description\":\"feature matrix\",\"indexes\":[\"${prefix}*\"],\"expiresAt\":null,\"actions\":[\"search\",\"documents.add\",\"documents.delete\",\"indexes.create\",\"indexes.delete\",\"indexes.swap\",\"settings.update\",\"settings.get\",\"tasks.get\",\"tasks.delete\",\"stats.get\"]}")"
    scoped_key="$(printf '%s' "$key_json" | node -e 'let t="";process.stdin.on("data",(c)=>{t+=c}).on("end",()=>{process.stdout.write(JSON.parse(t).key)})')"
    key_uid="$(printf '%s' "$key_json" | node -e 'let t="";process.stdin.on("data",(c)=>{t+=c}).on("end",()=>{process.stdout.write(JSON.parse(t).uid)})')"
    cleanup_search() {
      stop_api
      meili_master DELETE "/keys/${key_uid}" > /dev/null || true
      for uid in $(meili_master GET "/indexes?limit=1000" | node -e 'let t="";process.stdin.on("data",(c)=>{t+=c}).on("end",()=>{for(const i of JSON.parse(t).results){if(i.uid.startsWith(process.argv[1]))console.log(i.uid)}})' "$prefix"); do
        meili_master DELETE "/indexes/${uid}" > /dev/null || true
      done
    }
    trap cleanup_search EXIT
    export SEARCH_ENABLED=true MEILI_API_KEY="$scoped_key" MEILI_INDEX_PREFIX="$prefix"
    node apps/api/dist/database/migrate.js
    node apps/api/dist/seed/seed.js
    marked="$(search_rows)"
    echo "search tables after the seed: $marked"
    case "$marked" in
      "queue=0 "*) echo "expected the seed's catalog writes to mark products for the index" >&2; exit 1 ;;
    esac
    node apps/api/dist/search/reindex.js
    drained="$(search_rows)"
    echo "search tables after search:reindex: $drained"
    case "$drained" in
      "queue=0 "*) ;;
      *) echo "expected search:reindex to drain the queue" >&2; exit 1 ;;
    esac
    MATRIX_SEARCH_ENABLED=true run_api "" "" "none" ""
    trap cleanup_search EXIT
    results="$(curl -fsS "http://127.0.0.1:${port}/store/search?q=screwdriver&locale=en")"
    echo "store/search?q=screwdriver -> $results"
    echo "$results" | grep -q '"title":"Demo Screwdriver"' \
      || { echo "expected the seeded screwdriver in the search results" >&2; cat /tmp/fluxkit-matrix-api.log >&2; exit 1; }
    suggestions="$(curl -fsS "http://127.0.0.1:${port}/store/search/suggest?q=screw&locale=en")"
    echo "store/search/suggest?q=screw -> $suggestions"
    echo "$suggestions" | grep -q '"title":"Demo Screwdriver"' \
      || { echo "expected the seeded screwdriver among the suggestions" >&2; exit 1; }
    ! grep -qF "$scoped_key" /tmp/fluxkit-matrix-api.log \
      || { echo "the API log contains the search key" >&2; exit 1; }
    ;;
  *)
    echo "unknown mode: $mode" >&2
    exit 2
    ;;
esac
echo "feature/provider matrix '$mode': OK"
