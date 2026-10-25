import { Inject, Injectable } from "@nestjs/common";
import {
  buildShippingAdjustment,
  checkSelectionForKind,
  quoteShippingMethod,
  validateAddress,
  type Address,
  type Money,
  type PickupPoint,
  type ShippingAdjustment,
  type ShippingPayer,
  type ShippingSelection,
  type StoreLocale,
} from "@fluxkit/core";
import { PRICING_CONFIG, type PricingConfig } from "../../common/pricing-config.js";
import { findPostgresError } from "../../common/postgres-errors.js";
import {
  ruleViolation,
  shippingChanged,
  shippingProviderUnavailable,
  validationFailed,
} from "../../common/problem.js";
import type { Transaction } from "../../common/transaction.js";
import {
  ShippingDirectoryService,
  type PickupPointResolution,
} from "./shipping-directory.service.js";
import {
  methodKind,
  notOffered,
  offeredMethods,
  toShippingOption,
} from "./shipping-options.service.js";
import { SHIPPING_STORE_LIMITS } from "./shipping-store-limits.js";
import type { ShippingChanged, ShippingOption } from "./shipping-store.schemas.js";
import {
  ShippingStoreRepository,
  type StoreShippingMethodRow,
} from "./shipping-store.repository.js";

const METHOD_FK = "order_shipping_method_id_fkey";

/** What the checkout resolved BEFORE its transaction (the only place a provider is called). */
export interface PreparedShipping {
  readonly pickup?: {
    readonly providerCode: string;
    readonly ref: string;
    readonly resolution: PickupPointResolution;
  };
}

export const NOTHING_PREPARED: PreparedShipping = Object.freeze({});

export type ShippingDecision =
  /** The method cannot be used for this order: the consent check answers (`cart_changed` first, else `shipping_changed`). */
  | { readonly kind: "unavailable"; readonly changed: ShippingChanged }
  | {
      readonly kind: "priced";
      readonly method: StoreShippingMethodRow;
      readonly price: Money;
      readonly payer: ShippingPayer;
      /** Subtotal plus price, as the options endpoint showed it. */
      readonly total: Money;
      readonly point: PickupPoint | null;
      readonly estimate: Money | null;
      /** The option as the options endpoint returns it (the `shipping` member of `shipping_changed`). */
      readonly option: ShippingOption;
      readonly adjustment: ShippingAdjustment;
      /** What `sales_order.shipping_address` stores: the shopper's address, or for a pickup point a readable one. */
      readonly shippingAddress: Address | null;
    };

export interface ShippingDecisionInput {
  readonly selection: ShippingSelection;
  readonly subtotal: Money;
  readonly shippingAddress: Address | null;
  readonly locale: StoreLocale;
  readonly prepared: PreparedShipping;
}

/**
 * The checkout's shipping (ADR 0029 decision 4). Three parts, so that no provider is ever called inside the checkout
 * transaction or under one of its locks:
 * - `prepare`, BEFORE the transaction: resolves a pickup point through the directory cache or ONE provider call (5 s limit);
 *   the checkout skips it when the idempotency key already names an order (a replay never calls a provider);
 * - `decide`, inside the transaction after the cart is priced: reads the method WITHOUT a lock (the lock order of ADR 0015
 *   is unchanged), applies the kind rules, and quotes it with core (`quoteShippingMethod`), from memory only;
 * - `write`, after the existing inserts: the `order_shipping` snapshot and the one shipping `order_adjustment` row.
 */
@Injectable()
export class ShippingCheckoutService {
  constructor(
    @Inject(ShippingStoreRepository) private readonly repository: ShippingStoreRepository,
    @Inject(ShippingDirectoryService) private readonly directory: ShippingDirectoryService,
    @Inject(PRICING_CONFIG) private readonly pricing: PricingConfig,
  ) {}

  /**
   * Whether the shop offers at least one method (`shipping_method_required`, ADR 0029 decision 4): the methods the options
   * endpoint lists, by the same filter (`offeredMethods`, review M-1). Active methods in another currency or pickup point
   * methods of a provider that is not loaded do not count, so they cannot lock every checkout out.
   */
  async offeredMethodExists(tx: Transaction): Promise<boolean> {
    const rows = await this.repository.listActive(SHIPPING_STORE_LIMITS.maxMethods, tx);
    return (
      offeredMethods(
        rows,
        this.pricing.shopCurrency,
        (code) => this.directory.provider(code) !== undefined,
      ).length > 0
    );
  }

  /** BEFORE the transaction, outside every lock. Only a pickup point of an enabled provider needs anything. */
  async prepare(selection: ShippingSelection | undefined): Promise<PreparedShipping> {
    const ref = selection?.pickupPointRef;
    if (selection === undefined || ref === undefined) {
      return NOTHING_PREPARED;
    }
    const method = await this.repository.findByCode(selection.methodCode);
    if (method === undefined || method.kind !== "pickup_point" || method.providerCode === null) {
      return NOTHING_PREPARED;
    }
    const provider = this.directory.provider(method.providerCode);
    if (provider === undefined) {
      return NOTHING_PREPARED;
    }
    return {
      pickup: {
        providerCode: provider.code,
        ref,
        // The reserved gate slot: a flood of store lookups cannot make a checkout wait for its point (review m-2).
        resolution: await this.directory.resolvePickupPoint(provider, ref, "priority"),
      },
    };
  }

  /**
   * Inside the transaction, from the database and memory only. Throws the 400s of the selection (`shipping.pickupPointRef`
   * `required` / `not_applicable` / `unknown_pickup_point`, `shippingAddress` `shipping_address_required` /
   * `not_applicable`), `503 shipping_provider_unavailable` and `409 rule_violation total_out_of_range`.
   */
  async decide(tx: Transaction, input: ShippingDecisionInput): Promise<ShippingDecision> {
    const { selection, locale } = input;
    const method = await this.repository.findByCode(selection.methodCode, tx);
    if (method === undefined || !method.isActive) {
      return { kind: "unavailable", changed: notOffered(selection.methodCode, "inactive") };
    }
    if (method.currency !== this.pricing.shopCurrency) {
      return {
        kind: "unavailable",
        changed: notOffered(selection.methodCode, "currency_not_offered"),
      };
    }
    const kind = methodKind(method);
    const forKind = checkSelectionForKind(kind, selection);
    if (!forKind.ok) {
      throw validationFailed([{ path: "shipping.pickupPointRef", code: forKind.reason }]);
    }
    if (kind === "address" && input.shippingAddress === null) {
      throw validationFailed([{ path: "shippingAddress", code: "shipping_address_required" }]);
    }
    if (kind === "pickup_point" && input.shippingAddress !== null) {
      // The address of a pickup point order is the point's; a sent address would be silently replaced.
      throw validationFailed([{ path: "shippingAddress", code: "not_applicable" }]);
    }

    const provider =
      method.providerCode === null ? undefined : this.directory.provider(method.providerCode);
    let point: PickupPoint | null = null;
    if (kind === "pickup_point" && provider !== undefined) {
      point = this.pickupPoint(provider.code, selection.pickupPointRef ?? "", input.prepared);
    }
    const countryCode =
      kind === "pickup_point" ? point?.countryCode : input.shippingAddress?.countryCode;
    const quote = quoteShippingMethod({
      method: {
        kind,
        isActive: method.isActive,
        currency: method.currency,
        countryCodes: method.countryCodes,
        providerCode: method.providerCode,
        pricing: method.pricing,
      },
      providerEnabled: method.providerCode === null || provider !== undefined,
      shopCurrency: this.pricing.shopCurrency,
      countryCode,
      subtotal: input.subtotal,
    });
    if (!quote.available) {
      if (quote.reason === "total_out_of_range") {
        throw ruleViolation(
          "The order total with shipping is too large to be ordered. Remove a line.",
          "total_out_of_range",
        );
      }
      return { kind: "unavailable", changed: toShippingOption(method, quote, locale, null) };
    }
    const estimate =
      point === null || provider === undefined
        ? null
        : this.directory.peekEstimate({
            providerCode: provider.code,
            methodCode: method.code,
            service: method.providerService,
            cityRef: point.cityRef,
            pickupPointRef: point.ref,
            subtotal: input.subtotal,
          });
    return {
      kind: "priced",
      method,
      price: quote.price,
      payer: quote.payer,
      total: quote.total,
      point,
      estimate,
      option: toShippingOption(method, quote, locale, estimate),
      adjustment: buildShippingAdjustment({
        methodCode: method.code,
        title: method.title as Record<string, string>,
        price: quote.price,
        providerCode: method.providerCode,
      }),
      shippingAddress: point === null ? input.shippingAddress : readableAddress(point),
    };
  }

  /** After the order, its lines and reservations: the snapshot and the adjustment, all or nothing with the order. */
  async write(
    tx: Transaction,
    orderId: string,
    decision: Extract<ShippingDecision, { kind: "priced" }>,
  ): Promise<void> {
    const { method, point, adjustment } = decision;
    try {
      await this.repository.insertOrderShipping(tx, {
        orderId,
        methodId: method.id,
        methodCode: method.code,
        kind: method.kind,
        providerCode: method.providerCode,
        providerService: method.providerService,
        title: { ...adjustment.label },
        amount: decision.price.amount,
        currency: decision.price.currency,
        payer: decision.payer,
        estimatedCarrierAmount: decision.estimate?.amount ?? null,
        destination:
          point === null
            ? null
            : {
                providerRef: point.ref,
                number: point.number,
                kind: point.kind,
                cityRef: point.cityRef,
                cityName: point.cityName,
                description: point.description,
              },
      });
    } catch (error) {
      // The method was deleted after it was read (an admin delete never waits for a checkout that has not inserted yet).
      if (findPostgresError(error)?.constraint === METHOD_FK) {
        throw shippingChanged(notOffered(method.code, "inactive"));
      }
      throw error;
    }
    await this.repository.insertAdjustment(tx, {
      orderId,
      kind: adjustment.kind,
      code: adjustment.code,
      label: { ...adjustment.label },
      amount: adjustment.amount.amount,
      includedInPrice: adjustment.includedInPrice,
      source: adjustment.source,
    });
  }

  /** The point resolved before the transaction, else the cache; never a provider call here. */
  private pickupPoint(providerCode: string, ref: string, prepared: PreparedShipping): PickupPoint {
    const early =
      prepared.pickup !== undefined &&
      prepared.pickup.providerCode === providerCode &&
      prepared.pickup.ref === ref
        ? prepared.pickup.resolution
        : undefined;
    if (early?.status === "unknown") {
      throw validationFailed([{ path: "shipping.pickupPointRef", code: "unknown_pickup_point" }]);
    }
    if (early?.status === "found") {
      return early.point;
    }
    // Not prepared for this provider (the method changed in between) or the provider was unreachable: the cache only.
    const cached = this.directory.peekPickupPoint(providerCode, ref);
    if (cached === undefined) {
      throw shippingProviderUnavailable(SHIPPING_STORE_LIMITS.retryAfterSeconds);
    }
    return cached;
  }
}

/** `sales_order.shipping_address` of a pickup point order: the point's country, city and description (ADR 0029 decision 4). */
function readableAddress(point: PickupPoint): Address {
  const checked = validateAddress({
    countryCode: point.countryCode,
    city: point.cityName,
    line1: point.description,
  });
  if (!checked.ok) {
    // The directory admits only points whose texts fit an address; anything else is a bug.
    throw new RangeError("A pickup point does not make a valid address");
  }
  return checked.address;
}
