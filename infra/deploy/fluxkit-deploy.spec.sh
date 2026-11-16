#!/usr/bin/env bash
# Control-flow regression of the real rolling helpers. Docker/Compose, health and DNS waits are in-memory boundaries;
# no containers, files, env secrets or releases are changed. Real networking is covered by scripts/deploy-smoke.sh.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
# Read only the real helper functions; do not execute the script's host mutations or command-line entry point.
eval "$(sed -n '/^replica_count()/,/^# Under the forced command/p' "$SCRIPT_DIR/fluxkit-deploy")"

log() { :; }
fail() { echo "FAIL: $*" >&2; exit 1; }
export WAIT_SECONDS=1
stage=0
events=''
fail_second=false
matching=false

compose() {
  local service argument
  for argument in "$@"; do service=$argument; done
  case "$2" in
    config) echo "$service new-hash" ;;
    ps)
      echo 'old1 old2'
      if [[ "$*" != *--status* ]]; then
        [[ "$stage" -lt 1 ]] || echo new1
        [[ "$stage" -lt 2 ]] || echo new2
      fi
      ;;
    up)
      stage=$((stage + 1))
      [[ "$*" == *"--scale api=$((2 + stage))"* ]] || fail "unexpected scale: $*"
      events="$events start$stage"
      ;;
    *) fail "unexpected compose call: $*" ;;
  esac
}

docker() {
  case "$1" in
    inspect)
      if [[ "$3" == *config-hash* ]]; then
        if [[ "$matching" == true ]]; then echo new-hash; else echo old-hash; fi
      elif [[ "$4" == new2 && "$fail_second" == true ]]; then
        echo 'restarting unhealthy'
      else
        echo 'running healthy'
      fi
      ;;
    stop|rm) events="$events $1-$2" ;;
    *) fail "unexpected docker call: $*" ;;
  esac
}
sleep() { events="$events wait$1"; }

if ! roll_service /unused api 2; then fail "healthy replacement failed"; fi
[[ "$events" == ' start1 start2 wait11 stop-old1 rm-old1 wait11 stop-old2 rm-old2 wait11' ]] ||
  fail "successful rollout order: $events"
echo 'ok   sequential starts, health before old retirement, DNS waits between removals'

stage=0
events=''
fail_second=true
if roll_service /unused api 2; then fail "unhealthy second replacement succeeded"; fi
[[ "$events" == ' start1 start2 stop-new2 rm-new2 wait11 stop-new1 rm-new1 wait11' ]] ||
  fail "failed rollout must withdraw newest first with DNS waits and preserve both old IDs: $events"
echo 'ok   second replacement failure removes newest first, DNS waits between removals, old replicas untouched'

stage=0
events=''
matching=true
if ! roll_service /unused api 2; then fail "matching service failed"; fi
[[ -z "$events" ]] || fail "matching config hash and count should skip: $events"
echo 'ok   matching configuration and replica count skip replacement'
