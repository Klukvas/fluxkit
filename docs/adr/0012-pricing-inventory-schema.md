# 0012. Pricing and inventory schema: journal deletion, SET NULL and cascades

Status: accepted 2026-10-16 (decisions of the schema step of `docs/plans/2026-10-16-pricing-and-inventory.md`; the migration was approved with the plan). Implements the data part of ADR 0011.

## Context

- ADR 0011 says `stock_movement` is an append-only journal guarded by a trigger that rejects UPDATE and DELETE.
- Two foreign keys of that table act on its rows: `variant_id` (a variant can be deleted, for example with a never-published product) and `actor_id` (an admin user can be deleted). A plain "reject every UPDATE and DELETE" trigger would make both impossible: `ON DELETE CASCADE` is a DELETE and `ON DELETE SET NULL` is an UPDATE of the journal row.

## Decision

- **One trigger, one test of nesting depth.** `stock_movement_append_only` is a `BEFORE UPDATE OR DELETE ... FOR EACH ROW` trigger. `pg_trigger_depth()` is 1 for a statement sent by a client and greater than 1 inside a referential action (the foreign key machinery is itself a trigger). The function therefore allows exactly two things at depth above 1 and rejects everything else with SQLSTATE `23001` (`restrict_violation`):
  - DELETE: the cascade from `variant`.
  - UPDATE that sets `actor_id` from a value to NULL and changes no other column (compared as `to_jsonb(NEW) - 'actor_id' = to_jsonb(OLD) - 'actor_id'`): the `SET NULL` from `admin_user`.
- **Journal rows follow their variant (`ON DELETE CASCADE`).** The alternatives were `RESTRICT` (a journal row would make a variant undeletable, so a never-published product with a receipt could never be removed) and no foreign key (orphan rows, no integrity). Deleting a variant is already limited by the catalog rules (only variants of a draft product, or a product that was never published, can be deleted; see `docs/api/catalog.md`); orders keep a snapshot and never reference the journal. Cascade keeps the journal complete for every variant that exists and removes it only together with the variant.
- **`actor_id` is `ON DELETE SET NULL`.** The journal keeps the movement and loses the pointer to a deleted user (personal data leaves with the user). `reason` and `reference` stay.
- **`location_id` is `ON DELETE RESTRICT` everywhere** (levels, journal, reservations): a location with stock or history cannot be deleted.
- **Not covered by the trigger:** `TRUNCATE`, `ALTER TABLE ... DISABLE TRIGGER` and a superuser. The application database role is not meant to do any of that; the guard stops code bugs, not a database administrator. A user-written trigger on another table could also delete journal rows at depth above 1; no such trigger exists.
- **`main` location.** The migration inserts one default location (`main`, `Main`) so a single-warehouse shop never meets locations. Its id is a generated uuid (like every other id); code and tests look it up by `code`.
- **No CHECK that `reserved <= on_hand`** on `inventory_level`: backorder must be able to oversell. The stock operations enforce it under the row lock (ADR 0011).
- **Limits mirror `packages/core`:** price amounts `0..MAX_AMOUNT` (10^12), `on_hand` and `on_hand_after` `0..MAX_ON_HAND` (10^9), reservation quantity `1..MAX_QUANTITY` (10^6). The spec tests the boundaries with the TypeScript constants, so a change on one side fails the other.
- **Existing variants** become tracked with no backorder (`track_inventory` true, `allow_backorder` false), as decided in the plan.

## Consequences

- Tests exercise both exceptions and every rejection against real Postgres (`pricing-inventory-schema.spec.ts`).
- The trigger function is a separate database object: `0003_pricing_inventory.down.sql` drops it, and test helpers that drop tables by hand must drop it too.
- Stock operations (step 4) write the journal in the same transaction as the level change and never need to update or delete a journal row.
