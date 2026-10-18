#!/usr/bin/env bash
# Feature matrix (AGENTS.md section 18). Usage: scripts/feature-matrix.sh on|off|deleted
#   on      build, start the API with FEATURES_ENABLED=example, expect /health and /example/ping
#   off     build, start the API with no features, expect /health and 404 on /example/ping
#   deleted remove packages/features/_example, reinstall, then lint, typecheck, boundaries and tests must pass (destructive: CI only)
set -euo pipefail

mode="${1:?usage: scripts/feature-matrix.sh on|off|deleted}"
: "${DATABASE_URL:?DATABASE_URL must be set}"
port="${MATRIX_PORT:-3999}"
# The API refuses to start without it (ADR 0023); this one is throwaway and only lives in the process started below.
export ORDER_TOKEN_SECRET="${ORDER_TOKEN_SECRET:-feature-matrix-throwaway-secret-0123456789}"

run_api() {
  local features="$1"
  pnpm build
  FEATURES_ENABLED="$features" PORT="$port" node apps/api/dist/main.js > /tmp/fluxkit-matrix-api.log 2>&1 &
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
  *)
    echo "unknown mode: $mode" >&2
    exit 2
    ;;
esac
echo "feature matrix '$mode': OK"
