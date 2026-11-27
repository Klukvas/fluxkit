#!/usr/bin/env bash
# Control-flow regression of the real rolling helpers. Docker/Compose, health and DNS waits are in-memory boundaries;
# no containers, real env files or releases are changed. Digest fixtures are disposable. Real networking: scripts/deploy-smoke.sh.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
# Read only the real helper functions; do not execute the script's host mutations or command-line entry point.
eval "$(sed -n '/^release_digest()/,/^# Under the forced command/p' "$SCRIPT_DIR/fluxkit-deploy")"

(
  fixture=$(mktemp -d)
  trap 'rm -rf "$fixture"' EXIT
  summary_file="$fixture/summary"
  result=0
  (
    log 'running migrations to completion'
    printf 'private migration output\n'
    fail 'release failed'
  ) > "$fixture/detail" 2>&1 || result=$?
  [[ "$result" == 1 ]] || { echo 'FAIL: deploy failure must exit 1'; exit 1; }
  printf 'fluxkit deploy: running migrations to completion\nfluxkit deploy: release failed\n' > "$fixture/expected"
  cmp "$fixture/expected" "$summary_file"
  grep -qx 'private migration output' "$fixture/detail"
)
echo 'ok   summary carries status and failure lines without detailed command output'

log() { :; }
fail() { echo "FAIL: $*" >&2; exit 1; }
export WAIT_SECONDS=1 MIGRATE_WAIT_SECONDS=600

(
  LOG_DIR=$(mktemp -d)
  trap 'rm -rf "$LOG_DIR"' EXIT
  for sequence in $(seq 1 21); do
    printf -v log_file '%s/fluxkit-deploy-20261127T1200%02d000000000Z-123abcd-AbC123.log' "$LOG_DIR" "$sequence"
    touch "$log_file" "$log_file.summary" "$log_file.status"
  done
  deploy_log=$log_file
  oldest="$LOG_DIR/fluxkit-deploy-20261127T120001000000000Z-123abcd-AbC123.log"
  unrelated="$LOG_DIR/fluxkit-deploy-operator-notes.log"
  touch "$unrelated"
  prune_deploy_logs
  [[ ! -e "$oldest" && ! -e "$oldest.summary" && ! -e "$oldest.status" ]] || fail 'oldest deploy log or sidecar was kept'
  set -- "$LOG_DIR"/*.log
  [[ $# == 21 && -f "$deploy_log" && -f "$unrelated" ]] || fail 'log retention did not keep 20 deploy logs and the unrelated log'
)
echo 'ok   log retention keeps 20 deploy logs and leaves unrelated files alone'

(
  # shellcheck disable=SC2329 # The evaluated backup helper calls this logger indirectly.
  log() { echo "$*"; }
  fixture=$(mktemp -d)
  BACKUP_COMMAND="$fixture/backup"
  backup_enabled=''
  trap 'rm -f "$BACKUP_COMMAND"; rmdir "$fixture"' EXIT
  unset FLUXKIT_DEPLOY_ALLOW_NO_BACKUP

  if message=$(check_backup_command 2>&1); then fail 'missing backup command was allowed'; fi
  [[ "$message" == *"$BACKUP_COMMAND"*FLUXKIT_DEPLOY_ALLOW_NO_BACKUP=1* ]] || fail "unexpected backup refusal: $message"

  export FLUXKIT_DEPLOY_ALLOW_NO_BACKUP=1
  message=$(check_backup_command 2>&1 && [[ "$backup_enabled" == false ]]) || fail 'backup opt-out did not allow deployment'
  [[ "$message" == *WARNING*"$BACKUP_COMMAND"* ]] || fail "missing backup opt-out warning: $message"

  export FLUXKIT_DEPLOY_ALLOW_NO_BACKUP=true
  if (check_backup_command) 2>/dev/null; then fail 'backup opt-out accepted a value other than 1'; fi

  unset FLUXKIT_DEPLOY_ALLOW_NO_BACKUP
  if (BACKUP_COMMAND=backup check_backup_command) 2>/dev/null; then fail 'relative backup command was allowed'; fi
  printf '#!/bin/sh\nexit 0\n' > "$BACKUP_COMMAND"
  if (check_backup_command) 2>/dev/null; then fail 'non-executable backup command was allowed'; fi
  chmod +x "$BACKUP_COMMAND"
  check_backup_command
  [[ "$backup_enabled" == true ]] || fail 'executable backup command will not run'
)
echo 'ok   deploy requires an executable backup command unless the opt-out is exactly 1'

# shellcheck disable=SC2329 # The evaluated real Compose helper calls these Docker/timeout boundaries indirectly.
(
  fixture=$(mktemp -d)
  trap 'rm -f "$fixture/infra/docker-compose.prod.yml" "$fixture/env" "$fixture/env.pre-deploy" "$fixture/meili"; rmdir "$fixture/infra" "$fixture"' EXIT
  mkdir "$fixture/infra"
  printf 'services: {}\n' > "$fixture/infra/docker-compose.prod.yml"
  ENV_FILE="$fixture/env"
  MEILI_ENV_FILE="$fixture/meili"
  printf 'FLUXKIT_IMAGE_TAG=1111111\n' > "$ENV_FILE"
  printf 'fixture-only\n' > "$MEILI_ENV_FILE"
  previous_digest=$(release_digest "$fixture")
  [[ "$previous_digest" =~ ^[a-f0-9]{64}$ ]] || fail 'release digest is not sha256'
  cp -p "$ENV_FILE" "$ENV_FILE.pre-deploy"
  printf 'FLUXKIT_IMAGE_TAG=2222222\n' > "$ENV_FILE"
  [[ "$(release_digest "$fixture")" != "$previous_digest" ]] || fail 'env change did not change digest'
  cp -p "$ENV_FILE.pre-deploy" "$ENV_FILE"
  cmp -s "$ENV_FILE" "$ENV_FILE.pre-deploy" || fail 'rollback env is not byte-identical'
  [[ "$(release_digest "$fixture")" == "$previous_digest" ]] || fail 'restored env changed previous release digest'
  printf '# new compose\n' >> "$fixture/infra/docker-compose.prod.yml"
  compose_digest=$(release_digest "$fixture")
  [[ "$compose_digest" != "$previous_digest" ]] || fail 'Compose change did not change digest'
  printf 'changed-fixture\n' > "$MEILI_ENV_FILE"
  expected_digest=$(release_digest "$fixture")
  [[ "$expected_digest" != "$compose_digest" ]] || fail 'Meilisearch env change did not change digest'

  docker() {
    [[ "$FLUXKIT_RELEASE_DIGEST" == "$expected_digest" ]] || fail 'Compose did not receive release digest'
    [[ "$FLUXKIT_ENV_FILE" == "$ENV_FILE" && "$FLUXKIT_MEILI_ENV_FILE" == "$MEILI_ENV_FILE" ]] || fail 'Compose env paths differ'
    [[ "$*" == "compose --env-file $ENV_FILE -f $fixture/infra/docker-compose.prod.yml ps -q api" ]] || fail "unexpected Docker command: $*"
  }
  compose "$fixture" ps -q api
  timeout() {
    [[ "$1 $2" == '--kill-after=10s 600' ]] || fail "migration timeout arguments: $*"
    shift 2
    "$@"
  }
  COMPOSE_TIMEOUT_SECONDS=600 compose "$fixture" ps -q api
)
echo 'ok   all three release inputs affect digest, byte-identical env restore matches, Compose exports digest and bounds migration'

# shellcheck disable=SC2329 # The evaluated start_release helper calls these Compose/roll boundaries indirectly.
(
  roll_service() { events="$events roll-$2"; }
  for migrate_result in 124 137 1 0; do
    events=''
    compose() {
      case "$*" in
        *--exit-code-from*)
          [[ "$COMPOSE_TIMEOUT_SECONDS" == 600 ]] || fail 'migration has no independent timeout'
          events="$events migrate"
          return "$migrate_result"
          ;;
        *'kill migrate') events="$events kill"; return 1 ;;
        *'rm -f migrate') events="$events rm"; return 1 ;;
        *'postgres meilisearch redis') events="$events infrastructure" ;;
        *) events="$events final-up" ;;
      esac
    }
    result=0
    start_release /unused 2 2 || result=$?
    case "$migrate_result" in
      124|137) expected=' infrastructure migrate kill rm' ;;
      1) expected=' infrastructure migrate' ;;
      0) expected=' infrastructure migrate roll-api roll-storefront final-up' ;;
    esac
    [[ "$events" == "$expected" ]] || fail "migration result $migrate_result: $events"
    if [[ "$migrate_result" == 0 ]]; then
      [[ "$result" == 0 ]] || fail 'successful release failed'
    else
      [[ "$result" != 0 ]] || fail 'failed migration did not fail release'
    fi
  done
)
echo 'ok   timed-out migrations kill/remove even if cleanup fails; failed migrations never roll applications'

stage=0
events=''
fail_second=false
matching=false
stopped=false
wrong_digest_id=''

release_digest() { echo new-digest; }
# Release directories: one whose Compose file declares the digest label, one from before the label existed.
releases=$(mktemp -d)
trap 'rm -rf "$releases"' EXIT
mkdir -p "$releases/labelled/infra" "$releases/legacy/infra"
printf 'labels:\n  com.fluxkit.release-digest: x\n' > "$releases/labelled/infra/docker-compose.prod.yml"
printf 'services: {}\n' > "$releases/legacy/infra/docker-compose.prod.yml"
legacy=false

compose() {
  case "$2" in
    config) fail 'rollout must not depend on Compose config --hash' ;;
    ps)
      echo 'old1 old2'
      [[ "$stopped" != true ]] || echo stopped1
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
      if [[ "$3" == *release-digest* ]]; then
        if [[ "$legacy" == true ]]; then
          # Rolling back to a release without the label: its old replicas and its replacements carry an empty label.
          if [[ "$4" == old* && "$matching" != true ]]; then echo new-digest; else echo ''; fi
        elif [[ "$4" == new* && "$4" != "$wrong_digest_id" || "$matching" == true ]]; then
          echo new-digest
        else
          echo old-digest
        fi
      elif [[ "$3" == *State.Running* ]]; then
        if [[ "$4" == stopped1 ]]; then echo false; else echo true; fi
      elif [[ "$4" == new2 && "$fail_second" == true ]]; then
        echo 'restarting unhealthy'
      else
        echo 'running healthy'
      fi
      ;;
    stop|rm)
      events="$events $1-$2"
      if [[ "$1 $2" == 'rm stopped1' ]]; then stopped=false; fi
      ;;
    *) fail "unexpected docker call: $*" ;;
  esac
}
sleep() { events="$events wait$1"; }

if ! roll_service "$releases/labelled" api 2; then fail "healthy replacement failed"; fi
[[ "$events" == ' start1 start2 wait11 stop-old1 rm-old1 wait11 stop-old2 rm-old2 wait11' ]] ||
  fail "successful rollout order: $events"
echo 'ok   sequential starts, health before old retirement, DNS waits between removals'

stage=0
events=''
fail_second=true
if roll_service "$releases/labelled" api 2; then fail "unhealthy second replacement succeeded"; fi
[[ "$events" == ' start1 start2 stop-new2 rm-new2 wait11 stop-new1 rm-new1 wait11' ]] ||
  fail "failed rollout must withdraw newest first with DNS waits and preserve both old IDs: $events"
echo 'ok   second replacement failure removes newest first, DNS waits between removals, old replicas untouched'

stage=0
events=''
matching=true
if ! roll_service "$releases/labelled" api 2; then fail "matching service failed"; fi
[[ -z "$events" ]] || fail "matching release digest and count should skip: $events"
echo 'ok   matching release digest and replica count skip replacement'

stage=0
events=''
matching=false
fail_second=false
stopped=true
if ! roll_service "$releases/labelled" api 2; then fail "replacement with a stopped container failed"; fi
[[ "$events" == ' rm-stopped1 start1 start2 wait11 stop-old1 rm-old1 wait11 stop-old2 rm-old2 wait11' ]] ||
  fail "stopped container must be removed before staging: $events"
echo 'ok   pre-existing stopped container removed before Compose can reuse it'

stage=0
events=''
wrong_digest_id=new1
if roll_service "$releases/labelled" api 2; then fail "wrong-digest replacement succeeded"; fi
[[ "$events" == ' start1 stop-new1 rm-new1 wait11' ]] ||
  fail "wrong-digest stage must remove only new containers and preserve old ones: $events"
echo 'ok   healthy replacement with the wrong release digest fails staging and preserves old replicas'

stage=0
events=''
wrong_digest_id=new2
if roll_service "$releases/labelled" api 2; then fail "wrong-digest second replacement succeeded"; fi
[[ "$events" == ' start1 start2 stop-new2 rm-new2 wait11 stop-new1 rm-new1 wait11' ]] ||
  fail "second-stage digest mismatch must withdraw newest first and preserve old containers: $events"
echo 'ok   every staging step checks the release digest before retiring any old replica'

stage=0
events=''
wrong_digest_id=''
legacy=true
matching=true
if ! roll_service "$releases/legacy" api 2; then fail "untouched replicas of a legacy release failed"; fi
[[ -z "$events" ]] || fail "rollback to a release without the label must keep its untouched replicas: $events"
matching=false
if ! roll_service "$releases/legacy" api 2; then fail "rollback of a rolled service to a legacy release failed"; fi
[[ "$events" == ' start1 start2 wait11 stop-old1 rm-old1 wait11 stop-old2 rm-old2 wait11' ]] ||
  fail "a rolled service must return to the legacy release through its unlabelled replacements: $events"
echo 'ok   rollback to a release from before the digest label keeps its replicas and accepts its unlabelled replacements'
