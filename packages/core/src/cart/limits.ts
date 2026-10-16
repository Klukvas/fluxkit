/** Most lines one cart holds (plan 2026-10-17, Cart). Protects the API against huge carts; not a public contract. */
export const MAX_CART_LINES = 100;

/**
 * Largest quantity of one cart line. Far below `MAX_QUANTITY` of the pricing module, so a line total of
 * 999 x `MAX_AMOUNT` is the largest product any cart can ask for (and it is refused, not clamped).
 */
export const MAX_LINE_QUANTITY = 999;
