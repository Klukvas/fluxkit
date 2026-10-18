# API: cart

The shopper's cart (`/store/cart/*`), plan step 4 of `docs/plans/2026-10-17-cart-and-orders.md`. Decisions: `docs/adr/0015-cart-and-checkout.md`. Source of truth for routes and schemas: `docs/api/openapi.json`. No feature flag: the cart is core. A cart reserves nothing; `POST /store/checkout` turns it into an order (`docs/api/orders.md`) and then empties it (the lines go, the cart row and the cookie stay). The scheduler deletes expired carts (`docs/api/jobs.md`).

Every route is public (no login needed), sends `Cache-Control: no-store` (errors included), and every write needs `X-Fluxkit-CSRF: 1` and, with a body, `Content-Type: application/json` (otherwise `403 forbidden`, before anything else; every write route documents this `403` and the required header in `openapi.json`). Writes are limited per client address (`cartWrite`, 120 per minute, internal number): over the limit `429 too_many_requests` with `Retry-After`. All routes accept `?locale` (one of `LOCALES`, default `DEFAULT_LOCALE`, unknown is `400`); texts fall back to the default locale per field.

## Who owns a cart

- **There is no cart id anywhere in the API.** A cart is found only through the customer session cookie (a signed-in customer has ONE cart, bound to the account) or, for everyone else, the guest cart cookie. A cart id, a token or a customer id in a path, query, body or header selects nothing (a query or body field is `400 unknown_field`).
- **Guest cookie `fluxkit_cart`**: 32 random bytes (base64url, 43 characters); only its SHA-256 is stored (`cart.token_hash`). `HttpOnly`, `SameSite=Lax` (so a shopper arriving from a link on another site still sees the cart; writes are protected by the CSRF header), `Path=/store`, `Secure` unless `STORE_COOKIE_SECURE=false`, `Max-Age` = `CART_TTL_DAYS` in seconds. It is set again with every write (the lifetime slides). Only the first well-formed value in the `Cookie` header is read; anything else is ignored.
- **Lazy creation**: a read (`GET`, also `acknowledge` and `DELETE` on a shopper without a cart) never creates a row or a cookie. The first successful `POST /store/cart/items` creates the cart and sets the cookie. A refused first write (any 4xx) leaves nothing behind.
- **A cookie that matches no cart** (unknown, malformed, expired, deleted, merged) behaves as no cart. A write then creates a NEW cart with a NEW random token: a token the client chose is never adopted (no cart fixation). Writes that create nothing (`DELETE /store/cart`, `acknowledge` without a cart) clear such a dead cookie.
- **Signed-in customers**: the cart cookie is ignored while a customer session is valid (the guest cart is neither read, written nor renewed) and no cart cookie is set. At login or registration the guest cart is merged into the account's cart and the cookie is cleared (`docs/api/customers.md`). A customer whose session stops being valid (deactivated, expired) is a guest again.
- **Expiry**: every write sets `expires_at` to now + `CART_TTL_DAYS`; reads do not. An expired cart reads as the empty cart; a write to it starts from nothing (the stale lines are removed, the same token is kept). The scheduler deletes expired rows (`delete-carts`, `docs/api/jobs.md`); `pnpm jobs:run-once` does it by hand.

## Endpoints

| Endpoint | Purpose | Request | Response | Errors |
|---|---|---|---|---|
| `GET /store/cart` | The cart, repriced with the current catalog | `?locale` | `200` cart (the empty cart when there is none; a line that no longer fits the money limit is marked, see Amounts) | `400` locale or an unknown query field; `409` only when the SUBTOTAL does not fit (see Amounts) |
| `POST /store/cart/items` | Add a variant, or add to the quantity of its line (a new line goes last); creates the cart and the cookie on the first write | `{variantId, quantity}` (strict). `variantId` is a variant id (a product id is `404`), `quantity` a whole number from 1 to 999 | `200` cart | `400` structure, `unknown_field`, or `errors[0] = {path: "quantity", code: "invalid_quantity"}` for 0, negatives, fractions and anything that is not a JSON number (a missing `quantity` is `required`); `404` unknown variant; `409 rule_violation` with `rule` `variant_not_sellable`, `quantity_limit` (line would exceed 999, also for a first add of 1000), `too_many_lines`, or an amount rule; `429` |
| `PATCH /store/cart/items/{variantId}` | Set the quantity of a line (1 to 999) | `{quantity}` (strict) | `200` cart | `400` as above; `404` the cart has no such line (also: no cart, malformed id); `409 quantity_limit`; `429` |
| `DELETE /store/cart/items/{variantId}` | Remove a line (the cart stays, possibly empty) | none | `200` cart | `404` no such line; `409` unpriceable (see Amounts); `429` |
| `DELETE /store/cart` | Delete the whole cart (row and lines) and clear the cookie; the next add starts a new cart. Creates nothing | none | `204` | `429` |
| `POST /store/cart/acknowledge` | Accept the current prices: each available line takes its current unit price as the price the shopper has seen, which ends its `price_changed` notice. Unavailable lines are unchanged | none | `200` cart (the empty cart when there is none) | `409` unpriceable (see Amounts); `429` |

A write is one transaction that locks the cart row first, so parallel writes of one cart (two tabs) never lose a unit; the response is priced inside the same transaction, so it is exactly the committed state, and a result that cannot be priced is rolled back (see Amounts).

## The cart

```
{
  lines: [{
    variantId, productSlug, sku, title, variantTitle | null,
    optionValues: [{option, value}],
    image: {url, alt | null} | null,
    quantity,
    unitPrice: {amount, currency} | null, compareAtAmount | null, lineTotal: {amount, currency} | null,
    availability: "in_stock" | "low_stock" | "out_of_stock",
    notices: [{code: "price_changed", previousAmount: {amount, currency}} | {code: "unavailable"} | {code: "line_total_out_of_range"} | {code: "out_of_stock"}]
  }],
  subtotal: {amount, currency}, total: {amount, currency},
  itemCount, purchasable, requiresShipping, notices: []
}
```

- Money is `{amount, currency}` in minor units of the shop currency (ADR 0011); `compareAtAmount` is a number in the currency of `unitPrice`. The server computes every number with the core money functions (`priceCart`: `multiplyByQuantity`, `addMoney`); a price or total sent by a client is never read.
- **A cart holds no stock.** Adding reserves nothing; `availability` is the same status the store shows (`in_stock`, `low_stock`, `out_of_stock`). Stock quantities, locations, reservations, stock flags, internal attributes, other currencies' prices, ids of carts, lines, products or customers, and token hashes never appear in a cart response.
- **Lines** keep the order they were added in. `title` is the product title, `variantTitle` the variant's own title when it has one, `optionValues` the chosen options in the product's option order (names and labels in the locale). `image` is the product image tied to one of the variant's option values if there is one, else the first gallery image, else `null`.
- **`price_changed {previousAmount}`**: each line stores the unit price the shopper last saw (set by an add, a quantity change and `acknowledge`). The cart compares it with the current price on every read. The notice stays until the shopper acknowledges or changes the line (a price that returns to the seen value ends it by itself). A line seen in another currency (after `SHOP_CURRENCY` changed) shows it too, with the old currency in `previousAmount`.
- **`unavailable`**: the variant is no longer sellable, by the rule of the store (`isVariantSellable`: product `active`, variant active, price in the shop currency). The line stays (the shopper decides), `unitPrice` and `lineTotal` are `null`, `availability` is `out_of_stock` (never advertised as buyable), and it is left out of `subtotal`. `itemCount` still counts its quantity. A quantity change keeps its seen price; removing it works.
- **`line_total_out_of_range`**: a price rose so that this quantity no longer fits the money limit (`MAX_AMOUNT`). Shown only by `GET /store/cart`: the line is unavailable (`unitPrice` and `lineTotal` are `null`, it is left out of `subtotal`, `itemCount` still counts it, the cart is not `purchasable`) and this is its only notice. Lower the quantity or remove the line; the checkout refuses it (`checkout_refused`, `line_total_out_of_range`).
- **`out_of_stock`**: the availability status of a sellable line; it can still be added and kept (backorder and untracked variants are `in_stock`).
- **`purchasable`**: at least one line and no unavailable line. `total` equals `subtotal` until shipping, discount and tax adjustments exist (they do not yet). `notices` (cart level, `quantity_capped` and `lines_dropped`) is part of the shape but is always `[]` here: those notices are returned once, as `cartNotices` of login and registration, where the merge happens.
- **`requiresShipping`** (boolean, additive field, storefront plan step 2): whether the checkout will ask for a shipping address. It is core `shippingAddressRequired`, the very rule `POST /store/checkout` enforces, applied to the AVAILABLE lines (a line with a `lineTotal`) using the `requires_shipping` flag of each variant's product type, read from the catalog on every request (nothing is stored on the line; changing the flag of a product type changes the next read). `false` for an empty cart and for digital goods only; `true` as soon as one available line is a physical product, whatever else is in the cart. Unavailable lines (`unavailable`, `line_total_out_of_range`) are NOT counted: the checkout answers `409 cart_changed` for them before it looks at the address, so the flag describes the cart as it will be after the shopper fixes it (a cart with only an unavailable physical line and a digital line is `false`; removing the unavailable line does not change it). A line that is only out of stock IS counted: it is priced and stays in the order. For a purchasable cart, `POST /store/checkout` without `shippingAddress` is refused with `400 shipping_address_required` exactly when `requiresShipping` is `true` (a test checks both against the same carts); with an address it is always accepted, also when the flag is `false`. The flag is in every response that returns the cart shape (the five routes above and the `cart` of a `409 cart_changed`); `DELETE /store/cart` answers `204`.
- An empty cart is `{lines: [], subtotal/total: {amount: 0, currency}, itemCount: 0, purchasable: false, requiresShipping: false, notices: []}`.

## Limits (core constants, not contract)

At most 100 lines per cart (the 101st different variant is `409 too_many_lines`; an existing line can still grow), 1 to 999 units per line (going above 999 is `409 quantity_limit` and is never capped silently: the shopper typed the number; only the merge at sign-in caps), one line per variant. Bad quantities are `400 invalid_quantity` and are judged by the core cart rules, not by this layer.

## Amounts that do not fit (decision)

Core refuses to price a cart whose line total or subtotal exceeds the money limit (`MAX_AMOUNT`, 10^12 minor units); it never clamps. The API surfaces it as a problem, not as a partial cart:

- a write whose result cannot be priced is **rolled back** and answers `409 rule_violation` with `rule` `line_total_out_of_range` (with `errors[] = [{path: "lines.<variantId>", code: "line_total_out_of_range"}]` for every offending line) or `subtotal_out_of_range`. A refused first write creates no cart.
- a cart whose line became too large after it was filled (a price rose) is still READ: `GET /store/cart` answers `200` and marks that line `line_total_out_of_range` (above), so the shopper can see it and act. The shopper repairs it with writes that lead to a priceable cart (a lower quantity, `DELETE` of a line) or empties it with `DELETE /store/cart`, which always works. A write that leaves the cart unpriceable is refused with the `409` above, and the checkout refuses the line.
- a SUBTOTAL that does not fit while every line fits is still `409 subtotal_out_of_range` on `GET` (no single line is to blame); `DELETE` of a line repairs it.

This needs prices above about 10^9 minor units (10 million of the major unit) per unit at 999 units, so it is an edge case, not a normal flow.

## Concurrency and locks

Order of locks: customer row (`FOR KEY SHARE` for a customer write, `FOR UPDATE` held by the sign-in transaction) -> cart rows (lower id first when two are locked) -> cart lines. A customer's first write is `INSERT ... ON CONFLICT DO NOTHING` on the unique `customer_id` plus the row lock, so parallel first writes (several tabs or devices) end with exactly one cart and no lost unit. Two first writes of a guest without a cookie are two separate carts, each with its own cookie (there is no identity to share before the first cookie). The catalog is read in a fixed number of statements for any number of lines (no N+1; tested for 1 and 50 lines on a read and on every write).
