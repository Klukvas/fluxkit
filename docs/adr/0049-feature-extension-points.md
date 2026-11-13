# 0049. Extension points for feature packages with tables, permissions and media

Status: accepted (owner, 2026-11-13: approval of plan docs/plans/2026-11-13-blog.md with the recommended option of every question,
section 15 red zones 1 to 5). Builds on ADR 0018 (ports), 0028 (media upload), 0033 (personal data, "Feature rule") and 0046 (attach
by id); changes none of them. Records E1 to E4 of the plan (PR 1); E5 to E9 come with later PRs.

## Context
- AGENTS.md 2.1: an optional feature is a package under packages/features/<name>, loaded only when FEATURES_ENABLED names it. Until now
  a feature could only mount plain routes.
- A feature cannot import apps/api (packages-must-not-import-apps): no API problems (a plain HttpException loses errors[]), no admin
  permissions (an undecorated /admin route is denied to everyone), no database or media access, no migrations (one journal). ADR 0046
  "Context" listed these gaps.
- The first feature with a table (blog) needs all of them; later features reuse them.

## Decision
1. API kit packages/api-kit (@fluxkit/api-kit), depending on @nestjs/common (peer 12.2.0) and @fluxkit/core only. Public entry:
   ProblemException (+ ProblemCode, ProblemInit, FieldError, ProblemExtensions), RequirePermission, AdminController (+ DefaultPermissions),
   FEATURE_DATABASE, MEDIA_PORT, LOCALE_CONFIG (+ LocaleConfig). Moved unchanged with re-exports from the old apps/api paths; the four
   metadata key strings are pinned. ./internal holds the API-only values (not a contract; features must not import it). The kit's
   AdminController sets prefix and default-permission metadata; the API's applies it and adds the guard and Swagger decorators; feature
   routes are guarded by the global AdminPathGuard (401 signed out, 403 undeclared or lacking the permission). FEATURE_DATABASE is the
   API's Drizzle instance (one pool); MEDIA_PORT implements core MediaPort (markAttachedByIds(tx, refs) in the caller's transaction with
   upload_not_found at the caller's field; describeUploads(ids) -> {id, url, width, height}); LOCALE_CONFIG is the existing symbol.
   ZodValidationPipe and the problem factories are not moved.
2. Feature migrations: drizzle.config.ts, schema, drizzle/ with its own journal and hand-written .down.sql (which also deletes its row).
   pnpm db:migrate applies core then each feature in FEATURES_ENABLED, each in drizzle.__drizzle_migrations_feature_<name> (dash -> _),
   under MIGRATION_LOCK_KEY; refuses before applying anything when a table is ahead of its journal or an enabled feature has no package;
   never migrates a disabled feature. createApp refuses to start while an enabled feature has unapplied migrations (names the feature,
   not the database; runs before Nest on its own connection, only when a feature ships migrations). Foreign keys to core tables: a plain
   uuid in the feature schema, the constraint added by hand at the end of the generated SQL; the drift check is blind to it, the feature's
   spec asserts it (pg_constraint). Rejected: a stub of the core table in the kit. Down order: feature downs before any core down; core
   never references a feature table; no down command in v1. The drift script checks every folder with a drizzle.config.ts among the
   feature packages and the core fixture features. ensureMigrated(features?) compares core and feature journals with every migrations
   table and resets on any difference.
3. Inventory vocabulary and rules move to core privacy (PersonalDataInventory, checkPersonalDataInventory; re-exported in apps/api under
   the old names). The loader carries personalDataInventory; at startup the API merges it with the core inventory and refuses a malformed
   value, a broken rule, a table already classified, or no inventory while the feature ships migrations. The source guard allows table
   builders only in packages/features/<name>/src/schema.ts of a package whose src/index.ts exports personalDataInventory.
4. GET /store/config and GET /admin/config carry an additive features: string[] (loaded names from FEATURES_ENABLED, sorted).
5. The fixture feature apps/api/src/test/fixtures/features/notebook (a table with a hand-added foreign key to media_upload) proves
   all of the above in core specs.

## Consequences
- New public contracts (docs/contracts/README.md, "Feature extension points"); breaking one is a major release.
- A feature with tables depends on @fluxkit/api-kit, @fluxkit/core, drizzle-orm (and drizzle-kit for development) at the API's pinned
  versions; no new external dependency for the template.
- Enabling a feature with tables on a live shop: set FEATURES_ENABLED, run the migrate step, start the API. Removal: the feature's
  .down.sql files, newest first, before any core down; then delete its folders and flag. Deployment notes follow in PR 6.
- The hand-added foreign key is invisible to the drift check; only the feature's spec guards it.
- A feature's migrations run in their own transaction after the core's: a failing one leaves the core migrated.
