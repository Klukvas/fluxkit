#!/usr/bin/env bash
# Visual comparison of the storefront: base vs this tree, same machine, same run (plan
# docs/plans/2026-11-08-design-changeability.md, section 7; how to use it: apps/storefront/e2e/README.md, "Visual comparison").
#
#   bash scripts/visual-compare.sh <base-ref> [--skip-screenshots] [--keep-base-tree] [--skip-current-build]
#
# 1. The baseline is the merge-base of <base-ref> and HEAD (in CI, HEAD is the PR's merge commit, so this is the base
#    branch's tip). It is checked out with `git worktree add` into .visual/base-tree, installed (`pnpm install --offline`)
#    and built; THIS tree's harness (e2e/visual.config.ts, e2e/tests/*.visual.ts, e2e/support/visual/) is copied over it,
#    so both sides run the same selector list and frames. It records the computed styles into .visual/baseline/computed-styles
#    and writes the baseline screenshots into .visual/baseline/screenshots (`--update-snapshots=all`).
# 2. This tree is built (unless --skip-current-build) and records its computed styles into .visual/current/computed-styles,
#    then its screenshots are compared against the baseline.
# 3. .visual/report/ gets computed-styles.txt/.json (the diff), the Playwright HTML report and diff images of the screenshots,
#    summary.txt and two status files (computed-styles.status, screenshots.status: pass, fail or error).
#
# Declared exceptions: .visual/exceptions.json (e2e/support/visual/exceptions.ts), honoured only when THIS tree changed it
# against the merge-base; an inherited file belongs to an earlier PR and is ignored (with a notice).
#
# Needs the e2e stack's variables (E2E_DATABASE_URL ending in _e2e_test, REDIS_URL, MEILI_URL, MEILI_MASTER_KEY) and a
# Chromium for the pinned @playwright/test. The e2e database is WIPED by each of the runs. Baselines are never committed.
#
# Exit code: 0 everything identical (or declared), 1 undeclared computed-style differences, 3 screenshot differences only,
# 2 the harness itself failed (bad arguments, a build, a page that does not render, an invalid exceptions file).
set -euo pipefail

usage() {
  echo "Usage: bash scripts/visual-compare.sh <base-ref> [--skip-screenshots] [--keep-base-tree] [--skip-current-build]" >&2
  exit 2
}

base_ref=""
screenshots=true
keep_base_tree=false
build_current=true
for argument in "$@"; do
  case "$argument" in
    --skip-screenshots) screenshots=false ;;
    --keep-base-tree) keep_base_tree=true ;;
    --skip-current-build) build_current=false ;;
    -*) usage ;;
    *)
      [ -z "$base_ref" ] || usage
      base_ref="$argument"
      ;;
  esac
done
[ -n "$base_ref" ] || usage

harness_error() {
  echo "visual: $1 failed; the comparison is incomplete (exit 2)." >&2
  exit 2
}

root="$(git rev-parse --show-toplevel)"
out="$root/.visual"
base_tree="$out/base-tree"
report="$out/report"
harness_cli="$root/apps/storefront/e2e/support/visual/compare-cli.ts"

merge_base="$(git -C "$root" merge-base "$base_ref" HEAD)" || {
  echo "visual: cannot find the merge-base of $base_ref and HEAD (fetch the base branch with its history)." >&2
  exit 2
}
echo "visual: baseline is the merge-base $merge_base of $base_ref and HEAD"

rm -rf "$out/baseline" "$out/current" "$report"
mkdir -p "$out/baseline/computed-styles" "$out/baseline/screenshots" "$out/current/computed-styles" "$report"
echo "error" >"$report/computed-styles.status"
if $screenshots; then echo "error" >"$report/screenshots.status"; else echo "skipped" >"$report/screenshots.status"; fi

remove_base_tree() {
  if [ -d "$base_tree" ]; then
    git -C "$root" worktree remove --force "$base_tree" || rm -rf "$base_tree"
  fi
  git -C "$root" worktree prune
}
if ! $keep_base_tree; then trap remove_base_tree EXIT; fi

# Effective exceptions: the PR's own file, or nothing.
effective="$report/exceptions.effective.json"
declared="$root/.visual/exceptions.json"
if [ -f "$declared" ]; then
  if git -C "$root" cat-file -e "$merge_base:.visual/exceptions.json" 2>/dev/null &&
    git -C "$root" show "$merge_base:.visual/exceptions.json" | cmp -s - "$declared"; then
    echo "visual: .visual/exceptions.json is unchanged since the merge-base (an earlier PR's); it is ignored."
    echo "[]" >"$effective"
  else
    cp "$declared" "$effective"
    echo "visual: using the declared exceptions of this tree (.visual/exceptions.json)"
  fi
else
  echo "[]" >"$effective"
fi
node --experimental-strip-types "$harness_cli" --check-exceptions "$effective" ||
  harness_error "checking .visual/exceptions.json"
cp "$effective" "$out/baseline/screenshots/exceptions.json"

run_visual() {
  # $1: tree, $2: spec filter, rest: extra Playwright arguments. Environment: VISUAL_* set by the caller.
  local tree="$1" spec="$2"
  shift 2
  (cd "$tree" && pnpm --filter @fluxkit/storefront exec playwright test -c e2e/visual.config.ts "$spec" "$@")
}

copy_harness() {
  local target="$base_tree/apps/storefront/e2e"
  rm -rf "$target/support/visual" "$target"/tests/*.visual.ts "$target/visual.config.ts"
  mkdir -p "$target/support" "$target/tests"
  cp -R "$root/apps/storefront/e2e/support/visual" "$target/support/visual"
  cp "$root"/apps/storefront/e2e/tests/*.visual.ts "$target/tests/"
  cp "$root/apps/storefront/e2e/visual.config.ts" "$target/visual.config.ts"
}

# 1. Baseline.
remove_base_tree
git -C "$root" worktree add --detach "$base_tree" "$merge_base" || harness_error "checking out the base"
if ! (cd "$base_tree" && pnpm install --offline --frozen-lockfile); then
  echo "visual: the base's lockfile needs packages that are not in the local store; installing them (--prefer-offline)." >&2
  (cd "$base_tree" && pnpm install --prefer-offline --frozen-lockfile) || harness_error "installing the base"
fi
(cd "$base_tree" && pnpm build) || harness_error "building the base"
copy_harness

echo "visual: recording the baseline's computed styles"
VISUAL_COMPUTED_DIR="$out/baseline/computed-styles" VISUAL_SNAPSHOT_DIR="$out/baseline/screenshots" \
  run_visual "$base_tree" computed-styles || harness_error "recording the baseline's computed styles"
if $screenshots; then
  echo "visual: writing the baseline screenshots"
  VISUAL_COMPUTED_DIR="$out/baseline/computed-styles" VISUAL_SNAPSHOT_DIR="$out/baseline/screenshots" \
    run_visual "$base_tree" screenshots --update-snapshots=all || harness_error "writing the baseline screenshots"
fi

# 2. This tree.
if $build_current; then (cd "$root" && pnpm build) || harness_error "building this tree"; fi
echo "visual: recording this tree's computed styles"
VISUAL_COMPUTED_DIR="$out/current/computed-styles" VISUAL_SNAPSHOT_DIR="$out/baseline/screenshots" \
  run_visual "$root" computed-styles || harness_error "recording this tree's computed styles"

computed_exit=0
node --experimental-strip-types "$harness_cli" "$out/baseline/computed-styles" "$out/current/computed-styles" \
  --exceptions "$effective" --report "$report" || computed_exit=$?
case "$computed_exit" in
  0) echo "pass" >"$report/computed-styles.status" ;;
  1) echo "fail" >"$report/computed-styles.status" ;;
  *) harness_error "comparing the computed styles" ;;
esac

screenshot_exit=0
if $screenshots; then
  echo "visual: comparing this tree's screenshots with the baseline"
  VISUAL_COMPUTED_DIR="$out/current/computed-styles" VISUAL_SNAPSHOT_DIR="$out/baseline/screenshots" \
    run_visual "$root" screenshots || screenshot_exit=$?
  rm -rf "$report/screenshots-html" "$report/screenshots-results"
  [ ! -d "$root/apps/storefront/playwright-report/visual" ] ||
    cp -R "$root/apps/storefront/playwright-report/visual" "$report/screenshots-html"
  [ ! -d "$root/apps/storefront/test-results/visual" ] ||
    cp -R "$root/apps/storefront/test-results/visual" "$report/screenshots-results"
  if [ "$screenshot_exit" -eq 0 ]; then echo "pass" >"$report/screenshots.status"; else echo "fail" >"$report/screenshots.status"; fi
fi

{
  echo "Visual comparison: base $merge_base ($base_ref) vs $(git -C "$root" rev-parse HEAD) (plus uncommitted changes, if any)"
  echo "Computed styles: $(cat "$report/computed-styles.status") (computed-styles.txt)"
  echo "Screenshots: $(cat "$report/screenshots.status") (screenshots-html/index.html; diff images in screenshots-results/)"
} | tee "$report/summary.txt"

if [ "$computed_exit" -ne 0 ]; then exit 1; fi
if [ "$screenshot_exit" -ne 0 ]; then exit 3; fi
exit 0
