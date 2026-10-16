/**
 * Largest `on_hand` of one level (10^9). Fits a Postgres `integer` (about 2.1 * 10^9) and a JavaScript number with room
 * for sums over locations. A reservation or sale quantity is limited by `MAX_QUANTITY` of the pricing module.
 */
export const MAX_ON_HAND = 1_000_000_000;
