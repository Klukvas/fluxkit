const HUNDRED = BigInt(100);

function isAmount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * The saving a compare-at price shows, in whole percent, for the product page's discount badge (review D-08). Integer
 * arithmetic only (BigInt: the saving times a hundred can pass the safe integer range), rounded DOWN so a badge never promises more
 * than the prices give. `null` when there is nothing to show: compare-at not above the price, a saving that rounds down to
 * 0 %, or input that is not a whole non-negative minor-unit amount. Pure; it never changes or adds money.
 */
export function discountPercent(amount: number, compareAtAmount: number): number | null {
  if (!isAmount(amount) || !isAmount(compareAtAmount) || compareAtAmount <= amount) return null;
  const percent = Number((BigInt(compareAtAmount - amount) * HUNDRED) / BigInt(compareAtAmount));
  return percent === 0 ? null : percent;
}
