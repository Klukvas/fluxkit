/**
 * Largest `on_hand` of one level (10^9). Fits a Postgres `integer` (about 2.1 * 10^9) and a JavaScript number with room
 * for sums over locations. A reservation or sale quantity is limited by `MAX_QUANTITY` of the pricing module.
 */
export const MAX_ON_HAND = 1_000_000_000;

/**
 * Largest total `reserved` of one level, the same bound as `MAX_ON_HAND`. Backorder lets `reserved` pass `on_hand`, so
 * without this bound repeated reservations could exceed the Postgres `integer` column. The reserve decision refuses it
 * first; migration 0014 adds the same bound as a CHECK on `inventory_level.reserved` (docs/adr/0013).
 */
export const MAX_RESERVED = MAX_ON_HAND;
