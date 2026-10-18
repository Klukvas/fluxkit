import {
  InvalidResponseError,
  NetworkError,
  type Cart,
  type StoreClient,
} from "@fluxkit/api-client";
import { problemMessageKey, transportErrorMessageKey } from "./problem-messages";

/** Quantity per cart line: 1 to 999 (docs/api/cart.md). The API still validates it; this only avoids a pointless request. */
export const MIN_LINE_QUANTITY = 1;
export const MAX_LINE_QUANTITY = 999;

export type AddToCartOutcome =
  { status: "added"; cart: Cart } | { status: "failed"; messageKey: string };

export interface AddToCartInput {
  variantId: string;
  quantity: number;
  /** The page's locale, so cart texts in the answer match the page. */
  locale: string;
  signal?: AbortSignal;
  /** Called with the fresh cart after a success, before the outcome is returned (the header badge listens). */
  onAdded?: (cart: Cart) => void;
}

/**
 * `POST /store/cart/items` from the browser (the cart cookie has `Path=/store` and never reaches the Next server). The
 * client adds the CSRF header. Every failure the shopper can act on becomes a translated message KEY, never the API's text;
 * an abort and a programming error (`InvalidRequestError`) are rethrown, not shown.
 */
export async function addToCart(
  client: Pick<StoreClient, "addCartItem">,
  input: AddToCartInput,
): Promise<AddToCartOutcome> {
  if (
    !Number.isInteger(input.quantity) ||
    input.quantity < MIN_LINE_QUANTITY ||
    input.quantity > MAX_LINE_QUANTITY
  ) {
    return { status: "failed", messageKey: "errors.field.invalid_quantity" };
  }
  try {
    const result = await client.addCartItem(
      { variantId: input.variantId, quantity: input.quantity },
      {
        locale: input.locale,
        fetchOptions: { cache: "no-store" },
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      },
    );
    if (!result.ok) {
      return { status: "failed", messageKey: problemMessageKey(result.problem) };
    }
    input.onAdded?.(result.data);
    return { status: "added", cart: result.data };
  } catch (error) {
    if (error instanceof NetworkError && !error.aborted) {
      return { status: "failed", messageKey: transportErrorMessageKey("network") };
    }
    if (error instanceof InvalidResponseError) {
      return { status: "failed", messageKey: transportErrorMessageKey("invalidResponse") };
    }
    throw error;
  }
}
