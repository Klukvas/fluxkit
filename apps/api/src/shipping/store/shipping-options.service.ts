import { Inject, Injectable } from "@nestjs/common";
import {
  createMoney,
  isShippingMethodOffered,
  quoteShippingMethod,
  resolveTextWithFallback,
  SHIPPING_METHOD_KINDS,
  type Money,
  type PickupPoint,
  type ShippingMethodKind,
  type ShippingQuote,
  type StoreLocale,
} from "@fluxkit/core";
import { z } from "zod";
import { CartService, type CartOwner } from "../../cart/cart.service.js";
import { StoreService } from "../../catalog/store/store.service.js";
import { PRICING_CONFIG, type PricingConfig } from "../../common/pricing-config.js";
import { ShippingDirectoryService } from "./shipping-directory.service.js";
import { SHIPPING_STORE_LIMITS } from "./shipping-store-limits.js";
import type {
  ShippingChanged,
  ShippingOption,
  ShippingOptionsQuery,
  ShippingOptionsResponse,
} from "./shipping-store.schemas.js";
import {
  ShippingStoreRepository,
  type StoreShippingMethodRow,
} from "./shipping-store.repository.js";

const textMap = z.record(z.string(), z.string());

function text(value: unknown, locale: StoreLocale): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  // Written by the admin API after the locale rules: a stored value that does not parse is damaged data (loud).
  return resolveTextWithFallback(textMap.parse(value), locale.locale, locale.defaultLocale) ?? null;
}

export function methodKind(row: StoreShippingMethodRow): ShippingMethodKind {
  if (!SHIPPING_METHOD_KINDS.includes(row.kind as ShippingMethodKind)) {
    throw new RangeError(`Shipping method ${row.code} has an unknown kind`);
  }
  return row.kind as ShippingMethodKind;
}

/** The method as the storefront sees it, with what core decided for this cart. One builder for options and `shipping_changed`. */
export function toShippingOption(
  row: StoreShippingMethodRow,
  quote: ShippingQuote,
  locale: StoreLocale,
  estimate: Money | null,
): ShippingOption {
  const base = {
    methodCode: row.code,
    kind: methodKind(row),
    title: text(row.title, locale) ?? row.code,
    description: text(row.description, locale),
    providerCode: row.providerCode,
    countryCodes: [...row.countryCodes],
  };
  return quote.available
    ? {
        ...base,
        available: true,
        price: { ...quote.price },
        payer: quote.payer,
        total: { ...quote.total },
        estimate: estimate === null ? null : { ...estimate },
      }
    : {
        ...base,
        available: false,
        reason: quote.reason,
        price: null,
        payer: null,
        total: null,
        estimate: null,
      };
}

/**
 * The methods the shop offers (core `isShippingMethodOffered`): active, in the shop currency, and a `pickup_point` only with
 * its provider loaded. ONE filter for the options list and the checkout's "a method is required" switch (review M-1), so a
 * method no shopper can use is neither listed nor required.
 */
export function offeredMethods(
  rows: readonly StoreShippingMethodRow[],
  shopCurrency: PricingConfig["shopCurrency"],
  isProviderLoaded: (code: string) => boolean,
): StoreShippingMethodRow[] {
  return rows.filter((row) =>
    isShippingMethodOffered({
      method: { kind: methodKind(row), isActive: row.isActive, currency: row.currency },
      providerEnabled: row.providerCode === null || isProviderLoaded(row.providerCode),
      shopCurrency,
    }),
  );
}

/** The `shipping` member of `shipping_changed` for a method that is gone, inactive or in another currency. */
export function notOffered(
  methodCode: string,
  reason: "inactive" | "currency_not_offered",
): ShippingChanged {
  return { methodCode, available: false, reason };
}

/**
 * `GET /store/shipping/options` (ADR 0029 decision 5): the active methods for the caller's cart, each quoted by core
 * (`quoteShippingMethod`, the function the checkout uses), so `total` is exactly what the checkout will compute and the
 * storefront never adds money. Reads the cart like `GET /store/cart` (never creates one). The carrier is asked only for
 * the informational estimate and a pickup point's country, outside any transaction; any failure there leaves `estimate`
 * `null` and never fails the answer.
 */
@Injectable()
export class ShippingOptionsService {
  constructor(
    @Inject(ShippingStoreRepository) private readonly repository: ShippingStoreRepository,
    @Inject(ShippingDirectoryService) private readonly directory: ShippingDirectoryService,
    @Inject(CartService) private readonly carts: CartService,
    @Inject(StoreService) private readonly store: StoreService,
    @Inject(PRICING_CONFIG) private readonly pricing: PricingConfig,
  ) {}

  async options(owner: CartOwner, query: ShippingOptionsQuery): Promise<ShippingOptionsResponse> {
    const locale = this.store.resolveLocale(query.locale);
    const { cart } = await this.carts.read(owner, query.locale);
    const subtotal = this.money(cart.subtotal);
    if (cart.lines.length === 0 || !cart.requiresShipping) {
      return { subtotal, options: [] };
    }
    // A method in another currency than the shop's (ADR 0029 decision 3) or a pickup point method of a provider that is
    // not loaded is never offered: not even as unavailable (review M-1; the checkout's switch uses the same filter).
    const methods = offeredMethods(
      await this.repository.listActive(SHIPPING_STORE_LIMITS.maxMethods),
      this.pricing.shopCurrency,
      (code) => this.directory.provider(code) !== undefined,
    );
    const points = await this.pointsOf(methods, query.pickupPointRef);
    const options = await Promise.all(
      methods.map(async (row) => {
        const provider =
          row.providerCode === null ? undefined : this.directory.provider(row.providerCode);
        const point = row.providerCode === null ? undefined : points.get(row.providerCode);
        const kind = methodKind(row);
        const quote = quoteShippingMethod({
          method: {
            kind,
            isActive: row.isActive,
            currency: row.currency,
            countryCodes: row.countryCodes,
            providerCode: row.providerCode,
            pricing: row.pricing,
          },
          providerEnabled: row.providerCode === null || provider !== undefined,
          shopCurrency: this.pricing.shopCurrency,
          countryCode:
            kind === "pickup_point" ? (point?.countryCode ?? query.country) : query.country,
          subtotal,
        });
        let estimate: Money | null = null;
        if (quote.available && provider !== undefined && kind !== "store_pickup") {
          const usePoint = kind === "pickup_point" && point !== undefined;
          const cityRef = usePoint ? point.cityRef : query.cityRef;
          if (cityRef !== undefined) {
            estimate = await this.directory.estimate(provider, {
              providerCode: provider.code,
              methodCode: row.code,
              service: row.providerService,
              cityRef,
              pickupPointRef: usePoint ? point.ref : null,
              subtotal,
            });
          }
        }
        return toShippingOption(row, quote, locale, estimate);
      }),
    );
    return { subtotal, options };
  }

  /** The pickup point of `pickupPointRef` per provider of the shop's pickup-point methods (unknown or unreachable: none). */
  private async pointsOf(
    methods: readonly StoreShippingMethodRow[],
    ref: string | undefined,
  ): Promise<Map<string, PickupPoint>> {
    const found = new Map<string, PickupPoint>();
    if (ref === undefined) {
      return found;
    }
    const codes = new Set(
      methods
        .filter((row) => row.kind === "pickup_point" && row.providerCode !== null)
        .map((row) => row.providerCode as string),
    );
    await Promise.all(
      [...codes].map(async (code) => {
        const provider = this.directory.provider(code);
        if (provider === undefined) {
          return;
        }
        const resolved = await this.directory.resolvePickupPoint(provider, ref);
        if (resolved.status === "found") {
          found.set(code, resolved.point);
        }
      }),
    );
    return found;
  }

  private money(value: { amount: number; currency: string }): Money {
    const money = createMoney(value.amount, value.currency);
    if (!money.ok) {
      throw new RangeError(`The cart subtotal is not valid money: ${money.reason}`);
    }
    return money.money;
  }
}
