#!/bin/sh
# The stop wrapper stays in Docker DNS after the server exits, and does not delay anything else.
set -u
cd "$(dirname "$0")/../.." || exit 1
wrapper=infra/docker/stop-linger.sh
fail() { printf 'stop-linger: %s\n' "$1" >&2; exit 1; }

out=$(env -u FLUXKIT_STOP_LINGER_SECONDS "$wrapper" printf 'ran') || fail "direct exec exited $?"
[ "$out" = ran ] || fail "direct exec printed '$out'"

FLUXKIT_STOP_LINGER_SECONDS=1 "$wrapper" sleep 30 &
wrapper_pid=$!
sleep 0.2
kill -TERM "$wrapper_pid"
started=$(date +%s)
wait "$wrapper_pid" || fail "a stopped server must exit 0 so Compose does not restart it"
elapsed=$(( $(date +%s) - started ))
[ "$elapsed" -ge 1 ] || fail "left DNS immediately (${elapsed}s), before nginx can fail over"
[ "$elapsed" -le 4 ] || fail "lingered ${elapsed}s, longer than the 1s setting"

FLUXKIT_STOP_LINGER_SECONDS=5 "$wrapper" sh -c 'exit 3' &
wrapper_pid=$!
started=$(date +%s)
wait "$wrapper_pid"
status=$?
elapsed=$(( $(date +%s) - started ))
[ "$status" = 3 ] || fail "a crash exited $status, not 3"
[ "$elapsed" -le 1 ] || fail "a crash lingered ${elapsed}s; Compose would keep a dead server listed"

printf 'ok\n'
