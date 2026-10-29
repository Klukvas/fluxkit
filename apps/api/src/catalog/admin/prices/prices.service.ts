import { Inject, Injectable } from "@nestjs/common";
import { validatePrice, type Price, type PriceFailure } from "@fluxkit/core";
import { PRICING_CONFIG, type PricingConfig } from "../../../common/pricing-config.js";
import {
  notFound,
  ruleViolation,
  validationFailed,
  type FieldError,
} from "../../../common/problem.js";
import { withTransaction, type DbExecutor } from "../../../common/transaction.js";
import { SEARCH_PORT, type SearchPort } from "../../../common/search-port.js";
import { DRIZZLE, type Database } from "../../../database/database.module.js";
import { ProductsRepository, type ProductRow } from "../products/products.repository.js";
import { toPriceResponse } from "./prices.mapper.js";
import { PricesRepository, type NewPrice } from "./prices.repository.js";
import type {
  BulkPriceItem,
  PriceListResponse,
  PriceResponse,
  PutPriceBody,
  PutProductPricesBody,
} from "./prices.schemas.js";

/** Where a core price failure belongs in the request body. */
function fieldOfFailure(reason: PriceFailure): "amount" | "compareAtAmount" | "currency" | "" {
  switch (reason) {
    case "not_an_object":
      return "";
    case "unsupported_currency":
      return "currency";
    case "compare_at_not_a_number":
    case "compare_at_not_an_integer":
    case "compare_at_out_of_range":
    case "compare_at_not_greater":
      return "compareAtAmount";
    default:
      return "amount";
  }
}

/** Core decides what a valid price is; this only turns its verdict into field errors under `prefix`. */
function checkPrice(
  input: { amount: number; currency: string; compareAtAmount?: number | null | undefined },
  prefix: string,
): { price: Price } | { error: FieldError } {
  const result = validatePrice(input);
  if (result.ok) {
    return { price: result.price };
  }
  return {
    error: {
      path: [prefix, fieldOfFailure(result.reason)].filter((part) => part !== "").join("."),
      code: result.reason,
    },
  };
}

@Injectable()
export class PricesService {
  constructor(
    private readonly products: ProductsRepository,
    private readonly prices: PricesRepository,
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(PRICING_CONFIG) private readonly pricing: PricingConfig,
    @Inject(SEARCH_PORT) private readonly search: SearchPort,
  ) {}

  async list(productId: string, variantId: string): Promise<PriceListResponse> {
    await this.requireProduct(this.database, productId);
    await this.requireVariant(this.database, productId, variantId);
    const rows = await this.prices.listOfVariant(this.database, variantId);
    return { items: rows.map(toPriceResponse) };
  }

  /** All prices of all variants of the product, in the shape of the per-variant list. */
  async listOfProduct(productId: string): Promise<PriceListResponse> {
    await this.requireProduct(this.database, productId);
    const rows = await this.prices.listOfProduct(this.database, productId);
    return { items: rows.map(toPriceResponse) };
  }

  /** Creates the price or replaces it entirely (`compareAtAmount` absent or null clears the old price). */
  async put(
    productId: string,
    variantId: string,
    currency: string,
    body: PutPriceBody,
  ): Promise<{ price: PriceResponse; created: boolean }> {
    const checked = checkPrice({ ...body, currency }, "");
    if ("error" in checked) {
      throw validationFailed([checked.error]);
    }
    return withTransaction(this.database, async (tx) => {
      // The same product row lock publishing and variant edits take, so a price write cannot interleave with them.
      await this.lockProduct(tx, productId);
      await this.requireVariant(tx, productId, variantId);
      const existing = await this.prices.find(tx, variantId, currency);
      const [row] = await this.prices.upsertMany(tx, [toNewPrice(variantId, checked.price)]);
      if (row === undefined) {
        throw new Error("An upserted price was not returned.");
      }
      // Only the shop currency reaches a document; marking on every currency keeps the rule simple.
      await this.search.productsChanged(tx, [productId], "price_changed");
      return { price: toPriceResponse(row), created: existing === undefined };
    });
  }

  /**
   * Removes one price. The shop-currency price of an active variant of an active product cannot go: that would
   * leave a sellable variant without a price (the same fact core `publishPreconditions` checks as `price_missing`).
   */
  async delete(productId: string, variantId: string, currency: string): Promise<void> {
    await withTransaction(this.database, async (tx) => {
      const product = await this.lockProduct(tx, productId);
      const variant = await this.requireVariant(tx, productId, variantId);
      const existing = await this.prices.find(tx, variantId, currency);
      if (existing === undefined) {
        throw notFound("Price");
      }
      if (
        currency === this.pricing.shopCurrency &&
        variant.isActive &&
        product.status === "active"
      ) {
        throw ruleViolation(
          `The ${currency} price is the shop price of an active variant of a published product; unpublish the product or switch the variant off first.`,
          "last_shop_price",
        );
      }
      await this.prices.delete(tx, variantId, currency);
      await this.search.productsChanged(tx, [productId], "price_changed");
    });
  }

  /** Writes many prices of one product in one transaction: every item is valid, or nothing is written. */
  async putMany(productId: string, body: PutProductPricesBody): Promise<PriceListResponse> {
    const errors: FieldError[] = [];
    const accepted: { item: BulkPriceItem; price: Price }[] = [];
    const seen = new Set<string>();
    body.items.forEach((item, index) => {
      const prefix = `items.${index}`;
      const checked = checkPrice(item, prefix);
      if ("error" in checked) {
        errors.push(checked.error);
        return;
      }
      const key = `${item.variantId}:${checked.price.currency}`;
      if (seen.has(key)) {
        errors.push({
          path: prefix,
          code: "duplicate_item",
          message: "The same variant and currency appear more than once.",
        });
        return;
      }
      seen.add(key);
      accepted.push({ item, price: checked.price });
    });
    if (errors.length > 0) {
      throw validationFailed(errors);
    }

    return withTransaction(this.database, async (tx) => {
      await this.lockProduct(tx, productId);
      const known = new Set(
        (
          await this.prices.findVariantsOfProduct(
            tx,
            productId,
            body.items.map((item) => item.variantId),
          )
        ).map((row) => row.id),
      );
      const foreign: FieldError[] = body.items.flatMap((item, index) =>
        known.has(item.variantId)
          ? []
          : [
              {
                path: `items.${index}.variantId`,
                code: "invalid_reference",
                message: "The variant does not belong to this product.",
              },
            ],
      );
      if (foreign.length > 0) {
        throw validationFailed(foreign);
      }
      const rows = await this.prices.upsertMany(
        tx,
        accepted.map(({ item, price }) => toNewPrice(item.variantId, price)),
      );
      await this.search.productsChanged(tx, [productId], "price_changed");
      return { items: rows.map(toPriceResponse) };
    });
  }

  private async requireProduct(db: DbExecutor, productId: string): Promise<ProductRow> {
    const row = await this.products.findById(db, productId);
    if (row === undefined) {
      throw notFound("Product");
    }
    return row;
  }

  private async lockProduct(tx: DbExecutor, productId: string): Promise<ProductRow> {
    const row = await this.products.findByIdForUpdate(tx, productId);
    if (row === undefined) {
      throw notFound("Product");
    }
    return row;
  }

  private async requireVariant(
    db: DbExecutor,
    productId: string,
    variantId: string,
  ): Promise<{ id: string; isActive: boolean }> {
    const [row] = await this.prices.findVariantsOfProduct(db, productId, [variantId]);
    if (row === undefined) {
      throw notFound("Variant");
    }
    return row;
  }
}

function toNewPrice(variantId: string, price: Price): NewPrice {
  return {
    variantId,
    currency: price.currency,
    amount: price.amount,
    compareAtAmount: price.compareAtAmount,
  };
}
