import { Inject, Injectable } from "@nestjs/common";
import {
  createMoney,
  isVariantSellable,
  priceCart,
  type CartLine,
  type Money,
  type OrderLineFacts,
  type PriceCartResult,
  type PricedLineInput,
  type StoreLocale,
} from "@fluxkit/core";
import { productStatusSchema } from "../catalog/admin/products/products.schemas.js";
import type {
  ProductMediaRow,
  CartVariantRow,
  VariantOptionLabelRow,
} from "../catalog/store/store.repository.js";
import { StoreRepository } from "../catalog/store/store.repository.js";
import { pickListImage } from "../catalog/store/store.service.js";
import { priceVariants, type StoreVariantPricing } from "../catalog/store/store-pricing.js";
import { optionalText, requiredText } from "../catalog/store/store.serializer.js";
import { PRICING_CONFIG, type PricingConfig } from "../common/pricing-config.js";
import type { DbExecutor } from "../common/transaction.js";
import { ProblemException, type FieldError } from "../common/problem.js";
import type { CartResponse } from "./cart.schemas.js";

/** What the cart needs to know about the variant a shopper adds or changes. */
export interface VariantPriceLookup {
  readonly sellable: boolean;
  /** The current shop-currency unit price of a sellable variant, else `null`. */
  readonly unitPrice: Money | null;
}

/** Everything one pricing pass read and decided; `CartPricingService.toResponse` and `orderLineFacts` build on it. */
export interface PricedCart {
  /** The stored lines as given. */
  readonly stored: readonly CartLine[];
  /** The stored lines whose variant row exists (a variant deleted meanwhile is missing). */
  readonly present: readonly CartLine[];
  readonly rowsById: ReadonlyMap<string, CartVariantRow>;
  /** The sellable variants with their shop price and availability, exactly as the store computes them. */
  readonly priced: ReadonlyMap<string, StoreVariantPricing>;
  readonly labelsByVariant: ReadonlyMap<string, readonly VariantOptionLabelRow[]>;
  readonly media: readonly ProductMediaRow[];
  /** What core was given, in `present` order (the cart read prices it again without an overflowing line). */
  readonly inputs: readonly PricedLineInput[];
  readonly result: PriceCartResult;
}

/** `pickLineImage` needs a locale only for the alt text, which an order does not keep. */
const NO_LOCALE: StoreLocale = { locale: "und", defaultLocale: "und" };

/** The empty cart: no row exists, or it holds no line. The subtotal is zero in the shop currency. */
export function emptyCart(shopCurrency: PricingConfig["shopCurrency"]): CartResponse {
  const zero = { amount: 0, currency: shopCurrency };
  return {
    lines: [],
    subtotal: zero,
    total: zero,
    itemCount: 0,
    purchasable: false,
    notices: [],
  };
}

function toMoney(amount: number, currency: string): Money {
  const money = createMoney(amount, currency);
  if (!money.ok) {
    // A price row passed the sellable check, so its amount and currency are valid; anything else is corrupt data.
    throw new RangeError(`A stored price is not valid money: ${money.reason}`);
  }
  return money.money;
}

/**
 * The image of a cart line: one tied to a value the variant chose (the shopper bought the red one and sees the red
 * photo), else the first gallery image, as in the store list.
 */
function pickLineImage(
  media: readonly ProductMediaRow[],
  variantValueIds: ReadonlySet<string>,
  locale: StoreLocale,
) {
  const specific = media.find(
    (entry) => entry.optionValueId !== null && variantValueIds.has(entry.optionValueId),
  );
  return specific === undefined
    ? pickListImage(media, locale)
    : { url: specific.url, alt: optionalText(specific.alt, locale) };
}

/**
 * Turns stored cart lines into the cart the shopper sees: the CURRENT catalog price and availability of every line,
 * computed by core `priceCart`, with notices (ADR 0015). It reads the catalog through the store repository in a fixed
 * number of statements, whatever the number of lines, and applies the sellable rule of the store (`isVariantSellable`:
 * active product, active variant, price in the shop currency). It never does money arithmetic itself, never reads a
 * quantity of stock beyond feeding core's `availabilityOf`, and never returns one.
 */
@Injectable()
export class CartPricingService {
  constructor(
    @Inject(StoreRepository) private readonly store: StoreRepository,
    @Inject(PRICING_CONFIG) private readonly pricing: PricingConfig,
  ) {}

  emptyCart(): CartResponse {
    return emptyCart(this.pricing.shopCurrency);
  }

  /** The variants that are sellable, with their price and availability, exactly as the store computes them. */
  private priceSellable(
    rows: readonly CartVariantRow[],
    levels: Parameters<typeof priceVariants>[1],
  ): Map<string, StoreVariantPricing> {
    const sellable = rows.flatMap((row) =>
      row.priceAmount !== null &&
      row.priceCurrency !== null &&
      isVariantSellable({
        productStatus: productStatusSchema.parse(row.productStatus),
        variantIsActive: row.isActive,
        hasShopPrice: true,
      })
        ? [{ ...row, priceAmount: row.priceAmount, priceCurrency: row.priceCurrency }]
        : [],
    );
    return priceVariants(sellable, levels, this.pricing);
  }

  /**
   * Whether each variant exists and may be bought now, and its current unit price. One statement for any number of
   * ids. A missing key means the variant does not exist.
   */
  async lookupPrices(
    variantIds: readonly string[],
    executor: DbExecutor,
  ): Promise<Map<string, VariantPriceLookup>> {
    const rows = await this.store.listVariantsByIds(
      variantIds,
      this.pricing.shopCurrency,
      executor,
    );
    // No stock levels needed: availability does not decide whether a line can be added or which price it shows.
    const priced = this.priceSellable(rows, []);
    return new Map(
      rows.map((row) => {
        const entry = priced.get(row.id);
        const lookup: VariantPriceLookup =
          entry === undefined
            ? { sellable: false, unitPrice: null }
            : { sellable: true, unitPrice: toMoney(entry.price.amount, entry.price.currency) };
        return [row.id, lookup] as const;
      }),
    );
  }

  /**
   * The priced cart. Throws a `409 rule_violation` (`line_total_out_of_range` or `subtotal_out_of_range`) when core
   * refuses to price it: an amount that does not fit is never clamped (the caller's transaction rolls back).
   */
  async view(
    lines: readonly CartLine[],
    locale: StoreLocale,
    executor: DbExecutor,
  ): Promise<CartResponse> {
    if (lines.length === 0) {
      return this.emptyCart();
    }
    return this.toResponse(await this.price(lines, executor), locale);
  }

  /**
   * Reads the catalog facts of the lines and prices them with core `priceCart`, in a fixed number of statements. The
   * ONE pricing pass: the cart view and the checkout both build on its result, so an order is priced from exactly the
   * facts the cart showed. It does not throw when core refuses (`context.result.ok` is false); `view` does.
   */
  async price(lines: readonly CartLine[], executor: DbExecutor): Promise<PricedCart> {
    const variantIds = lines.map((line) => line.variantId);
    const rows = await this.store.listVariantsByIds(
      variantIds,
      this.pricing.shopCurrency,
      executor,
    );
    const productIds = [...new Set(rows.map((row) => row.productId))];
    // One after the other: a transaction runs on a single connection, which must not get a second query while one runs.
    const levels = await this.store.listStockLevelsForVariants(variantIds, executor);
    const labels = await this.store.listVariantOptionLabels(variantIds, executor);
    const media = await this.store.listMediaForProducts(productIds, executor);
    const priced = this.priceSellable(rows, levels);
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    // A variant deleted between the cart read and this one (only never-sold variants can be) has left the cart.
    const present = lines.filter((line) => rowsById.has(line.variantId));
    const inputs: PricedLineInput[] = present.map((line) => {
      const entry = priced.get(line.variantId);
      return {
        variantId: line.variantId,
        quantity: line.quantity,
        facts: {
          sellable: entry !== undefined,
          currentPrice: entry?.price ?? null,
          // An unavailable line is not for sale, whatever its stock: never advertise it as in stock.
          availability: entry?.availability ?? "out_of_stock",
          seen: line.seen,
        },
      };
    });
    const result = priceCart(this.pricing.shopCurrency, inputs);
    const labelsByVariant = new Map<string, VariantOptionLabelRow[]>();
    for (const label of labels) {
      labelsByVariant.set(label.variantId, [
        ...(labelsByVariant.get(label.variantId) ?? []),
        label,
      ]);
    }
    return { stored: lines, present, rowsById, priced, labelsByVariant, media, inputs, result };
  }

  /**
   * The cart as `GET /store/cart` shows it. Like `view`, except that a line whose total no longer fits the money limit (a
   * price rose after it was added) does not make the whole read a 409: that line is shown as unavailable (no price, no
   * total, left out of the subtotal) with the notice `line_total_out_of_range`, so the shopper can still read the cart and
   * lower the quantity or remove the line. Writes keep refusing (`view`), and the checkout refuses the line (`price`). A
   * subtotal that overflows with every line within the limit is still the 409 of `view`: no single line is to blame.
   */
  async readView(
    lines: readonly CartLine[],
    locale: StoreLocale,
    executor: DbExecutor,
  ): Promise<CartResponse> {
    if (lines.length === 0) {
      return this.emptyCart();
    }
    const context = await this.price(lines, executor);
    const { result } = context;
    if (result.ok || result.reason !== "line_total_out_of_range") {
      return this.toResponse(context, locale);
    }
    const overflowing = new Set(result.lineIndexes);
    const repriced = priceCart(
      this.pricing.shopCurrency,
      context.inputs.map((input, index) =>
        overflowing.has(index) ? { ...input, facts: { ...input.facts, sellable: false } } : input,
      ),
    );
    const marked = new Set(
      context.present.flatMap((line, index) => (overflowing.has(index) ? [line.variantId] : [])),
    );
    return this.toResponse({ ...context, result: repriced }, locale, marked);
  }

  /**
   * The cart response of a pricing pass. Throws the `409 rule_violation` of `view` when core refused to price it.
   * `overflowing` names lines already taken out of the pricing because their total does not fit (`readView`).
   */
  toResponse(
    context: PricedCart,
    locale: StoreLocale,
    overflowing: ReadonlySet<string> = new Set(),
  ): CartResponse {
    const { present, rowsById, labelsByVariant, media, result } = context;
    if (!result.ok) {
      throw this.unpriceable(result, present);
    }
    return {
      lines: result.lines.map((line) => {
        const row = rowsById.get(line.variantId);
        if (row === undefined) {
          throw new Error(`Priced line ${line.variantId} has no variant row`);
        }
        const chosen = labelsByVariant.get(line.variantId) ?? [];
        return {
          variantId: line.variantId,
          productSlug: row.productSlug,
          sku: row.sku,
          title: requiredText(row.productTitle, locale, `Product "${row.productSlug}" title`),
          variantTitle: optionalText(row.variantTitle, locale),
          optionValues: chosen.map((entry) => ({
            option: requiredText(entry.optionName, locale, "Option name"),
            value: requiredText(entry.valueLabel, locale, "Option value label"),
          })),
          image: pickLineImage(
            media.filter((entry) => entry.productId === row.productId),
            new Set(chosen.map((entry) => entry.optionValueId)),
            locale,
          ),
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          compareAtAmount: line.compareAtAmount,
          lineTotal: line.lineTotal,
          availability: line.availability,
          notices: overflowing.has(line.variantId)
            ? [{ code: "line_total_out_of_range" as const }]
            : line.notices.map((notice) =>
                notice.code === "price_changed"
                  ? {
                      code: notice.code,
                      previousAmount: {
                        amount: notice.previousAmount.amount,
                        currency: notice.previousAmount.currency,
                      },
                    }
                  : { code: notice.code },
              ),
        };
      }),
      subtotal: result.subtotal,
      // Shipping, discount and tax adjustments do not exist yet, so the total is the subtotal.
      total: result.subtotal,
      itemCount: result.itemCount,
      purchasable: result.purchasable,
      notices: [],
    };
  }

  /**
   * The facts `buildOrderLine` needs for every line of a priced, purchasable cart, in cart order: full translated
   * texts (not resolved to one locale), the chosen option values, the image and the unit price that `priceCart` used.
   * The caller has checked `context.result.ok`, that no line is unavailable and that no stored line went missing.
   */
  orderLineFacts(context: PricedCart): OrderLineFacts[] {
    const { present, rowsById, labelsByVariant, media, priced } = context;
    return present.map((line) => {
      const row = rowsById.get(line.variantId);
      const entry = priced.get(line.variantId);
      if (row === undefined || entry === undefined) {
        throw new Error(
          `Line ${line.variantId} is not priced; the caller must check purchasable first`,
        );
      }
      const chosen = labelsByVariant.get(line.variantId) ?? [];
      return {
        productId: row.productId,
        variantId: row.id,
        sku: row.sku,
        productTitle: row.productTitle,
        variantTitle: row.variantTitle,
        optionValues: chosen.map((label) => ({
          option: label.optionName,
          value: label.valueLabel,
        })),
        // The URL does not depend on the locale (only the alt text does); the alt is not part of the snapshot.
        imageUrl:
          pickLineImage(
            media.filter((item) => item.productId === row.productId),
            new Set(chosen.map((label) => label.optionValueId)),
            NO_LOCALE,
          )?.url ?? null,
        unitPrice: entry.price,
        quantity: line.quantity,
        requiresShipping: row.requiresShipping,
      };
    });
  }

  private unpriceable(
    refusal: Exclude<ReturnType<typeof priceCart>, { ok: true }>,
    lines: readonly CartLine[],
  ): ProblemException {
    if (refusal.reason === "line_total_out_of_range") {
      const errors: FieldError[] = refusal.lineIndexes.flatMap((index) => {
        const line = lines[index];
        return line === undefined
          ? []
          : [{ path: `lines.${line.variantId}`, code: "line_total_out_of_range" }];
      });
      return new ProblemException({
        code: "rule_violation",
        detail: "A line total is too large to be priced. Lower the quantity or remove the line.",
        errors,
        extensions: { rule: "line_total_out_of_range" },
      });
    }
    return new ProblemException({
      code: "rule_violation",
      detail: "The cart subtotal is too large to be priced. Remove a line.",
      extensions: { rule: "subtotal_out_of_range" },
    });
  }
}
