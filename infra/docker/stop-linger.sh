#!/bin/sh
# PID 1 beside the server (Compose `init` forwards the stop signal here).
#
# nginx keeps every resolved address of one upstream in shared memory. When a replica leaves
# Docker DNS, nginx rebuilds that list. A request that has already failed its first attempt
# then finds the list changed and is answered 502, instead of using the live replica
# (nginx 1.29.8, ngx_http_upstream_get_round_robin_peer). Stopping the server while this
# container stays listed lets nginx refuse the dead port, retry another replica and mark the
# peer down. fail_timeout on the upstream (20s) keeps that peer out until the DNS cache drops
# the address, so the later rebuild does not meet an in-flight retry.
#
# Unset, 0 or not a whole number: run the command as this process. Migrate and the admin
# commands do not set FLUXKIT_STOP_LINGER_SECONDS.
set -u

seconds="${FLUXKIT_STOP_LINGER_SECONDS:-0}"
case "$seconds" in
  "" | 0 | *[!0-9]*) exec "$@" ;;
esac

child=
# Invoked by the stop signal, not by name.
# shellcheck disable=SC2329
shutdown() {
  if [ -n "$child" ]; then
    kill -TERM "$child" 2>/dev/null || true
    wait "$child" 2>/dev/null || true
    child=
  fi
  sleep "$seconds"
  exit 0
}
trap shutdown TERM INT

"$@" &
child=$!
wait "$child"
status=$?
child=
exit "$status"
