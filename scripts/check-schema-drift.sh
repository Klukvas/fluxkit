#!/usr/bin/env bash
# Fails when the Drizzle schema (apps/api/src/database/schema) differs from the committed migrations.
#
# Runs `drizzle-kit generate` against a temporary COPY of apps/api/drizzle. If the schema is in sync, drizzle-kit
# reports "nothing to migrate" and creates no file; any new or changed file means a schema change has no committed
# migration. The real drizzle folder is never modified. No database is needed.
#
# drizzle-kit exits 0 even when it fails internally (for example on an absolute --out path), so success is only
# reported when its output says "nothing to migrate" AND the copy is identical to the committed folder.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
api_dir="$repo_root/apps/api"
scratch="$(mktemp -d)"
log="$scratch.log"
trap 'rm -rf "$scratch" "$log"' EXIT

cp -R "$api_dir/drizzle/." "$scratch/"

cd "$api_dir"
# drizzle-kit resolves `out` relative to the current directory, so pass a relative path.
DRIZZLE_KIT_OUT="$(realpath --relative-to="$api_dir" "$scratch")" \
  pnpm exec drizzle-kit generate --name schema_drift_check 2>&1 | tee "$log"

if ! diff -rq "$api_dir/drizzle" "$scratch"; then
  echo >&2
  echo "Schema drift: the Drizzle schema in apps/api/src/database/schema has changes without a committed migration." >&2
  echo "Run 'pnpm --filter @fluxkit/api db:generate', add the matching NNNN_name.down.sql, and commit both (AGENTS.md section 3)." >&2
  exit 1
fi

if ! grep -q "nothing to migrate" "$log"; then
  echo >&2
  echo "drizzle-kit did not report 'nothing to migrate'; the drift check could not run. See the output above." >&2
  exit 1
fi

echo "No schema drift: the committed migrations match the Drizzle schema."
