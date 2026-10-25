#!/usr/bin/env bash
# Feature and provider matrix (AGENTS.md section 18).
# Usage: scripts/feature-matrix.sh on|off|deleted|providers-on|providers-off|providers-deleted|providers-nova-post
#   on      build, start the API with FEATURES_ENABLED=example, expect /health and /example/ping
#   off     build, start the API with no features, expect /health and 404 on /example/ping
#   deleted remove packages/features/_example, reinstall, then lint, typecheck, boundaries and tests must pass (destructive: CI only)
# The provider modes do the same for the test-only shipping provider packages/providers/_fake (ADR 0029 decision 8). Their
# observable is the line the provider registry logs at startup, "Shipping providers loaded: <codes|none>": it needs no route
# and so no new public contract.
#   providers-on      build, start the API with SHIPPING_PROVIDERS_ENABLED=fake, expect the log line to name fake
#   providers-off     build, start the API with no providers, expect "none" and no mention of fake
#   providers-deleted remove packages/providers/_fake and packages/providers/nova-post, reinstall, then lint, typecheck,
#                     boundaries and tests must pass, and an API told to load fake or nova_post must refuse to start,
#                     loudly (destructive: CI only)
#   providers-nova-post build; an API with SHIPPING_PROVIDERS_ENABLED=nova_post and no NOVA_POST_API_KEY must refuse to
#                     start naming the variable; with an invented key it must start and report nova_post, never print the
#                     key, and send nothing to Nova Post at startup (the JWT is fetched on first use)
set -euo pipefail

mode="${1:?usage: scripts/feature-matrix.sh on|off|deleted|providers-on|providers-off|providers-deleted|providers-nova-post}"
: "${DATABASE_URL:?DATABASE_URL must be set}"
port="${MATRIX_PORT:-3999}"
# The API refuses to start without it (ADR 0023); this one is throwaway and only lives in the process started below.
export ORDER_TOKEN_SECRET="${ORDER_TOKEN_SECRET:-feature-matrix-throwaway-secret-0123456789}"

run_api() {
  local features="$1"
  local providers="${2:-}"
  pnpm build
  FEATURES_ENABLED="$features" SHIPPING_PROVIDERS_ENABLED="$providers" PORT="$port" node apps/api/dist/main.js > /tmp/fluxkit-matrix-api.log 2>&1 &
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
    rm -rf packages/providers/_fake packages/providers/nova-post
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
    # With an invented key: it starts, reports nova_post and the sandbox, never prints the key. No call is made at startup.
    invented_key="matrix-invented-key-$(date +%s)-0000000000"
    NOVA_POST_API_KEY="$invented_key" run_api "" "nova_post"
    grep -F "Shipping providers loaded: nova_post" /tmp/fluxkit-matrix-api.log \
      || { echo "expected the registry to report nova_post" >&2; cat /tmp/fluxkit-matrix-api.log >&2; exit 1; }
    grep -F "Nova Post environment: sandbox" /tmp/fluxkit-matrix-api.log \
      || { echo "expected the sandbox environment by default" >&2; cat /tmp/fluxkit-matrix-api.log >&2; exit 1; }
    ! grep -qF "$invented_key" /tmp/fluxkit-matrix-api.log \
      || { echo "the API log contains the Nova Post key" >&2; exit 1; }
    ;;
  *)
    echo "unknown mode: $mode" >&2
    exit 2
    ;;
esac
echo "feature/provider matrix '$mode': OK"
