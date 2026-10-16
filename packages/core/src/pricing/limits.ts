/**
 * Largest absolute amount in minor units (10^12). Far below 2^53, so every amount is an exact JavaScript number and
 * fits a Postgres bigint; a sum of two amounts is still exact before it is checked against this limit.
 */
export const MAX_AMOUNT = 1_000_000_000_000;

/** Largest quantity of one line. */
export const MAX_QUANTITY = 1_000_000;

/** 10 000 basis points are 100 %. */
export const BASIS_POINTS_PER_UNIT = 10_000;

/** Largest percentage: 100 times the amount. A markup above that is a bug in the caller, not a price. */
export const MAX_PERCENTAGE_BASIS_POINTS = 100 * BASIS_POINTS_PER_UNIT;
