#!/usr/bin/env bash
# Fails when a Drizzle schema differs from its committed migrations: the core one (apps/api/src/database/schema against
# apps/api/drizzle) and, since ADR 0049, every feature that has a drizzle.config.ts (its schema against its own drizzle/):
# the feature packages in packages/features and the core test fixture features in apps/api/src/test/fixtures/features.
#
# Runs `drizzle-kit generate` against a temporary COPY of each drizzle folder. If the schema is in sync, drizzle-kit
# reports "nothing to migrate" and creates no file; any new or changed file means a schema change has no committed
# migration. The real drizzle folders are never modified. No database is needed.
#
# drizzle-kit exits 0 even when it fails internally (for example on an absolute --out path), so success is only
# reported when its output says "nothing to migrate" AND the copy is identical to the committed folder.
#
# A foreign key a feature adds by hand to a core table (ADR 0049) is not in its schema, so this check never sees it;
# the feature's own spec asserts it in the migrated database.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
api_dir="$repo_root/apps/api"
# One drizzle-kit for every schema (apps/api's pinned devDependency); each config runs from its own folder.
drizzle_kit="$api_dir/node_modules/.bin/drizzle-kit"
scratch_dirs=()
cleanup() {
  for dir in "${scratch_dirs[@]+"${scratch_dirs[@]}"}"; do
    rm -rf "$dir" "$dir.log"
  done
}
trap cleanup EXIT

# Portable `realpath --relative-to` (GNU only): drizzle-kit resolves `out` relative to the current directory and fails on
# an absolute path.
relative_path() {
  node -e 'process.stdout.write(require("node:path").relative(process.argv[1], process.argv[2]))' "$1" "$2"
}

# check <label> <folder with drizzle.config.ts and drizzle/> <command to tell the author>
check() {
  local label="$1" dir="$2" fix="$3"
  local scratch log
  if [ ! -d "$dir/drizzle" ]; then
    echo "Schema drift: $label has a drizzle.config.ts but no drizzle/ folder. $fix" >&2
    exit 1
  fi
  scratch="$(mktemp -d)"
  scratch_dirs+=("$scratch")
  log="$scratch.log"
  cp -R "$dir/drizzle/." "$scratch/"

  echo "== $label"
  (cd "$dir" && DRIZZLE_KIT_OUT="$(relative_path "$dir" "$scratch")" \
    "$drizzle_kit" generate --name schema_drift_check 2>&1) | tee "$log"

  if ! diff -rq "$dir/drizzle" "$scratch"; then
    echo >&2
    echo "Schema drift: the Drizzle schema of $label has changes without a committed migration." >&2
    echo "$fix" >&2
    exit 1
  fi

  if ! grep -q "nothing to migrate" "$log"; then
    echo >&2
    echo "drizzle-kit did not report 'nothing to migrate' for $label; the drift check could not run. See the output above." >&2
    exit 1
  fi
}

check "core (apps/api)" "$api_dir" \
  "Run 'pnpm --filter @fluxkit/api db:generate', add the matching NNNN_name.down.sql, and commit both (AGENTS.md section 3)."

features=0
for config in "$repo_root"/packages/features/*/drizzle.config.ts "$api_dir"/src/test/fixtures/features/*/drizzle.config.ts; do
  [ -f "$config" ] || continue
  dir="$(dirname "$config")"
  check "feature ${dir#"$repo_root"/}" "$dir" \
    "Run drizzle-kit generate in ${dir#"$repo_root"/}, add the matching .down.sql (it also deletes its row from drizzle.__drizzle_migrations_feature_<name>), and commit both (docs/contracts/features.md)."
  features=$((features + 1))
done

echo "No schema drift: the committed migrations match the Drizzle schemas (core and $features feature schemas)."
