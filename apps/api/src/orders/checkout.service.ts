import { randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  buildOrderLine,
  compareMoney,
  computeOrderTotals,
  formatOrderNumber,
  ORDER_NUMBER_BYTES,
  guestAccessExpiresAt,
  orderExpiresAt,
  reservationExpiresAt,
  shippingAddressRequired,
  type OrderLineSnapshot,
  type StoreLocale,
} from "@fluxkit/core";
import { CLOCK, type Clock } from "../auth/clock.js";
import { hashSessionToken } from "../auth/session-token.js";
import { CartPricingService } from "../cart/cart-pricing.service.js";
import { CART_CONFIG, cartExpiry, type CartConfig } from "../cart/cart-config.js";
import { CartRepository, type CartRow } from "../cart/cart.repository.js";
import type { CartOwner } from "../cart/cart.service.js";
import { StoreService } from "../catalog/store/store.service.js";
import { retryOnDeadlock } from "../common/deadlock-retry.js";
import { LOCALE_CONFIG, type LocaleConfig } from "../common/locale.js";
import { isUniqueViolation } from "../common/postgres-errors.js";
import {
  cartChanged,
  cartEmpty,
  checkoutRefused,
  idempotencyKeyReused,
  ruleViolation,
  validationFailed,
} from "../common/problem.js";
import { withTransaction, type Transaction } from "../common/transaction.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { ReservationsService } from "../inventory/reservations/reservations.service.js";
import { deriveAccessToken, type IssuedAccessToken } from "./access-token.js";
import { fingerprintsEqual, requestFingerprint } from "./checkout-fingerprint.js";
import { parseCheckoutInput, type CheckoutInput } from "./checkout-input.js";
import { OrderViewService } from "./order-view.js";
import { ORDERS_CONFIG, type OrdersConfig } from "./orders-config.js";
import { OrdersRepository, type NewOrder, type OrderRow } from "./orders.repository.js";
import type { CheckoutBody, CheckoutResponse } from "./orders.schemas.js";
import { OrdersService } from "./orders.service.js";

const ORDER_NUMBER_KEY = "sales_order_number_key";
const IDEMPOTENCY_KEY_KEY = "sales_order_idempotency_key_key";
/** The plan (ADR 0017): a collision of the 40-bit number retries with a new one at most 5 times, then fails loudly. */
const ORDER_NUMBER_ATTEMPTS = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CheckoutRequest {
  readonly owner: CartOwner;
  /** The email of the signed-in customer's account (the default of a missing `email`); `undefined` for a guest. */
  readonly accountEmail: string | undefined;
  /** The `Idempotency-Key` header as received, or `undefined` when it was not sent. */
  readonly idempotencyKey: string | undefined;
  readonly body: CheckoutBody;
}

export interface CheckoutOutcome {
  /** 201 for a new order, 200 for the replay of a checkout that already happened. */
  readonly status: 200 | 201;
  readonly response: CheckoutResponse;
}

/**
 * Places the order of a cart (ADR 0015, plan step 5b): ONE transaction, all or nothing, with the documented lock order
 * customer (customers only) -> cart `FOR UPDATE` -> product rows -> variant rows (`FOR SHARE`, sorted) -> level rows
 * (`FOR UPDATE`, sorted, inside `reserveMany`) -> inserts. The catalog facts are read AFTER the product and variant
 * locks, so a price write, an unpublish, a switch-off or a delete either finished before they are read or waits until
 * the order is committed. Totals come from core only (`buildOrderLine`, `computeOrderTotals`); the client's
 * `expectedTotal` is a consent check and never a price. The cart is emptied (its lines are deleted, the cart row is
 * kept, so a replay of the same key still finds the cart it was made from) in the same transaction.
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger("Checkout");

  constructor(
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(CartRepository) private readonly carts: CartRepository,
    @Inject(CartPricingService) private readonly pricing: CartPricingService,
    @Inject(ReservationsService) private readonly reservations: ReservationsService,
    @Inject(OrdersRepository) private readonly orders: OrdersRepository,
    @Inject(OrdersService) private readonly orderService: OrdersService,
    @Inject(OrderViewService) private readonly views: OrderViewService,
    @Inject(StoreService) private readonly store: StoreService,
    @Inject(LOCALE_CONFIG) private readonly localeConfig: LocaleConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CART_CONFIG) private readonly cartConfig: CartConfig,
    @Inject(ORDERS_CONFIG) private readonly config: OrdersConfig,
  ) {}

  async place(request: CheckoutRequest): Promise<CheckoutOutcome> {
    if (request.idempotencyKey === undefined) {
      throw validationFailed([{ path: "Idempotency-Key", code: "idempotency_key_required" }]);
    }
    if (!UUID.test(request.idempotencyKey)) {
      throw validationFailed([{ path: "Idempotency-Key", code: "invalid_idempotency_key" }]);
    }
    const idempotencyKey = request.idempotencyKey.toLowerCase();
    const input = parseCheckoutInput(request.body, request.accountEmail);
    const locale = this.store.resolveLocale(input.requestedLocale);
    return retryOnDeadlock(
      () => this.attempt(request.owner, idempotencyKey, input, locale),
      (message) => this.logger.warn(message),
    );
  }

  /**
   * One run of the transaction. Two requests with the same key and different carts can both find no order; the second
   * insert then waits for the first and fails on the unique key: the whole transaction is rolled back and run once
   * more, which now finds the order and answers it (`idempotency_key_reused`, since the carts differ).
   */
  private async attempt(
    owner: CartOwner,
    idempotencyKey: string,
    input: CheckoutInput,
    locale: StoreLocale,
  ): Promise<CheckoutOutcome> {
    for (let round = 0; ; round += 1) {
      try {
        return await withTransaction(this.database, (tx) =>
          this.inTransaction(tx, owner, idempotencyKey, input, locale),
        );
      } catch (error) {
        if (round === 0 && isUniqueViolation(error, IDEMPOTENCY_KEY_KEY)) {
          continue;
        }
        throw error;
      }
    }
  }

  private async inTransaction(
    tx: Transaction,
    owner: CartOwner,
    idempotencyKey: string,
    input: CheckoutInput,
    locale: StoreLocale,
  ): Promise<CheckoutOutcome> {
    const now = this.clock.now();
    const cart = await this.lockCart(tx, owner);
    const fingerprint = requestFingerprint({
      cartId: cart?.id ?? "",
      email: input.email,
      phone: input.phone,
      firstName: input.firstName,
      lastName: input.lastName,
      shippingAddress: input.shippingAddress === null ? null : { ...input.shippingAddress },
      billingAddress: input.billingAddress === null ? null : { ...input.billingAddress },
      locale: locale.locale,
      expectedTotal: { amount: input.expectedTotal.amount, currency: input.expectedTotal.currency },
    });

    const existing = await this.orders.findByIdempotencyKey(tx, idempotencyKey);
    if (existing !== undefined) {
      return this.replay(tx, existing, owner, cart, fingerprint, locale, now);
    }
    if (cart === undefined || cart.expiresAt.getTime() <= now.getTime()) {
      throw cartEmpty();
    }
    const stored = await this.carts.listLines(cart.id, tx);
    if (stored.length === 0) {
      throw cartEmpty();
    }

    // Catalog locks first, THEN the facts: what is read below is what no one can change until this transaction ends.
    await this.reservations.lockVariantsForSale(
      tx,
      stored.map((line) => line.variantId),
    );
    const context = await this.pricing.price(stored, tx);
    if (context.present.length !== stored.length) {
      // A line's variant was deleted while the checkout waited for the locks: the cart the shopper saw is gone.
      throw cartChanged(this.pricing.toResponse(context, locale));
    }
    const priced = context.result;
    if (!priced.ok) {
      if (priced.reason === "line_total_out_of_range") {
        throw checkoutRefused(
          priced.lineIndexes.map((index) => ({
            path: `lines.${String(index)}`,
            code: "line_total_out_of_range",
          })),
        );
      }
      throw ruleViolation(
        "The cart subtotal is too large to be ordered. Remove a line.",
        "subtotal_out_of_range",
      );
    }
    if (!priced.purchasable) {
      throw cartChanged(this.pricing.toResponse(context, locale));
    }

    const lines = this.snapshotLines(context);
    const totals = computeOrderTotals(lines, []);
    if (!totals.ok) {
      // `priceCart` already refused every overflow, so core refusing the same lines is a bug, not a shopper's problem.
      throw new Error(`Order totals were refused after the cart was priced: ${totals.reason}`);
    }
    const agreed = compareMoney(totals.totals.total, input.expectedTotal);
    if (!agreed.ok || agreed.ordering !== 0) {
      throw cartChanged(this.pricing.toResponse(context, locale));
    }
    if (shippingAddressRequired(lines) && input.shippingAddress === null) {
      throw validationFailed([{ path: "shippingAddress", code: "shipping_address_required" }]);
    }

    const placedAt = now;
    const expiresAt = orderExpiresAt(placedAt, this.config.paymentTtlMinutes);
    // The id is drawn here, not by the database, because the guest token is derived from it (ADR 0023).
    const orderId = randomUUID();
    const guestToken =
      owner.kind === "guest" ? this.guestToken(orderId, idempotencyKey) : undefined;
    const order = await this.insertOrder(tx, {
      id: orderId,
      status: "awaiting_payment",
      customerId: owner.kind === "customer" ? owner.customerId : null,
      email: input.email,
      phone: input.phone,
      firstName: input.firstName,
      lastName: input.lastName,
      shippingAddress: input.shippingAddress,
      billingAddress: input.billingAddress,
      locale: locale.locale,
      currency: totals.totals.total.currency,
      subtotalAmount: totals.totals.subtotal.amount,
      shippingTotal: totals.totals.shippingTotal.amount,
      discountTotal: totals.totals.discountTotal.amount,
      taxTotal: totals.totals.taxTotal.amount,
      totalAmount: totals.totals.total.amount,
      accessTokenHash: guestToken?.hash ?? null,
      accessExpiresAt:
        guestToken === undefined ? null : guestAccessExpiresAt(now, this.config.guestAccessDays),
      idempotencyKey,
      requestFingerprint: fingerprint,
      placedAt,
      expiresAt,
    });

    // Reserve at the default location, all or nothing; the number is the reference of every hold.
    const reserved = await this.reservations.reserveMany(
      tx,
      stored.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
      { expiresAt: reservationExpiresAt(expiresAt), reference: order.number },
    );
    if (!reserved.ok) {
      throw checkoutRefused(
        reserved.refusals.map((refusal) => ({
          path: `lines.${String(stored.findIndex((line) => line.variantId === refusal.variantId))}`,
          code: refusal.reason,
        })),
      );
    }

    const itemRows = await this.orders.insertItems(
      tx,
      lines.map((line, position) => ({
        orderId: order.id,
        position,
        productId: line.productId,
        variantId: line.variantId,
        sku: line.sku,
        productTitle: { ...line.productTitle },
        variantTitle: line.variantTitle === null ? null : { ...line.variantTitle },
        optionValues: line.optionValues.map((entry) => ({
          option: { ...entry.option },
          value: { ...entry.value },
        })),
        imageUrl: line.imageUrl,
        unitAmount: line.unitPrice.amount,
        compareAtAmount: line.compareAtAmount,
        quantity: line.quantity,
        lineTotal: line.lineTotal.amount,
        currency: line.unitPrice.currency,
        requiresShipping: line.requiresShipping,
      })),
    );
    const itemByPosition = new Map(itemRows.map((row) => [row.position, row.id]));
    await this.orders.insertReservationLinks(
      tx,
      reserved.lines.flatMap((entry, position) => {
        const orderItemId = itemByPosition.get(position);
        if (orderItemId === undefined) {
          throw new Error(`Order line ${String(position)} was not inserted`);
        }
        return entry.kind === "reserved"
          ? [{ orderItemId, reservationId: entry.reservation.id }]
          : [];
      }),
    );
    await this.orderService.recordPlacement(tx, order, {
      type: owner.kind === "customer" ? "customer" : "guest",
    });

    // The cart is empty from now on: its lines go, the row stays (the cookie and the replay of this key still use it).
    await this.carts.deleteLines(cart.id, tx);
    await this.carts.touch(cart.id, now, cartExpiry(now, this.cartConfig), tx);

    const view = await this.views.view(tx, order, locale);
    return {
      status: 201,
      response:
        guestToken === undefined ? { order: view } : { order: view, accessToken: guestToken.token },
    };
  }

  /**
   * The same key again. Only whoever can still reach the cart this checkout was made from, with the same normalized
   * request, gets the order back; every other combination (another body, another cart, a lost cookie, another
   * principal) is the same `idempotency_key_reused` that does not say which part differed. A guest gets the SAME access
   * token as in the first answer: it is derived from the order id and the key (ADR 0023), so nothing rotates and every
   * answer of a double submit works. Only if `ORDER_TOKEN_SECRET` changed since the placement is the derived token a new
   * one; its hash then replaces the stored one, and the tokens of the old secret are dead.
   */
  private async replay(
    tx: Transaction,
    existing: OrderRow,
    owner: CartOwner,
    cart: CartRow | undefined,
    fingerprint: string,
    locale: StoreLocale,
    now: Date,
  ): Promise<CheckoutOutcome> {
    const samePrincipal =
      owner.kind === "customer"
        ? existing.customerId === owner.customerId
        : existing.customerId === null;
    // Both comparisons always run, so the answer does not depend on which one fails.
    const sameRequest = fingerprintsEqual(existing.requestFingerprint, fingerprint);
    if (cart === undefined || !samePrincipal || !sameRequest) {
      throw idempotencyKeyReused();
    }
    let order = existing;
    let accessToken: string | undefined;
    if (existing.customerId === null) {
      const derived = this.guestToken(existing.id, existing.idempotencyKey);
      order = await this.orders.renewGuestAccess(
        tx,
        existing.id,
        derived.hash,
        guestAccessExpiresAt(now, this.config.guestAccessDays),
      );
      accessToken = derived.token;
    }
    const view = await this.views.view(tx, order, locale);
    return {
      status: 200,
      response: accessToken === undefined ? { order: view } : { order: view, accessToken },
    };
  }

  /** The derived token of a guest order. A missing secret is a misconfiguration: loud, never a fallback key. */
  private guestToken(orderId: string, idempotencyKey: string): IssuedAccessToken {
    const secret = this.config.tokenSecret;
    if (secret === undefined) {
      throw new Error(
        "ORDER_TOKEN_SECRET is not configured, so a guest order cannot be given an access token.",
      );
    }
    return deriveAccessToken(secret, orderId, idempotencyKey);
  }

  /** The cart row of the owner, locked, expired or not (an expired cart only has no lines for ordering). */
  private async lockCart(tx: Transaction, owner: CartOwner): Promise<CartRow | undefined> {
    if (owner.kind === "customer") {
      if (!(await this.carts.keyShareCustomer(owner.customerId, tx))) {
        return undefined;
      }
      return this.carts.lockByCustomerId(owner.customerId, tx);
    }
    return owner.token === undefined
      ? undefined
      : this.carts.lockByTokenHash(hashSessionToken(owner.token), tx);
  }

  /** The order lines from the same facts the cart showed; an image that fails the snapshot rule is left out, not fatal. */
  private snapshotLines(
    context: Parameters<CartPricingService["orderLineFacts"]>[0],
  ): OrderLineSnapshot[] {
    const options = {
      defaultLocale: this.localeConfig.defaultLocale,
      locales: this.localeConfig.locales,
    };
    return this.pricing.orderLineFacts(context).map((facts) => {
      let built = buildOrderLine(facts, options);
      if (!built.ok && built.reason === "invalid_image_url") {
        this.logger.warn(
          `The image of variant ${facts.sku} is not a valid URL; the order line keeps none.`,
        );
        built = buildOrderLine({ ...facts, imageUrl: null }, options);
      }
      if (!built.ok) {
        // Damaged catalog data (a title without the default locale, a broken SKU): loud, never a half order.
        throw new Error(`The snapshot of variant ${facts.sku} was refused: ${built.reason}`);
      }
      return built.line;
    });
  }

  /** The 40 random bits of the next order number. Public only as a seam: a spec forces collisions through it. */
  nextOrderNumberBytes(): Uint8Array {
    return randomBytes(ORDER_NUMBER_BYTES);
  }

  /** Inserts the order with a fresh random number; a collision of the 40-bit number retries, at most 5 times. */
  private async insertOrder(tx: Transaction, values: Omit<NewOrder, "number">): Promise<OrderRow> {
    for (let attempt = 1; attempt <= ORDER_NUMBER_ATTEMPTS; attempt += 1) {
      const number = formatOrderNumber(this.nextOrderNumberBytes());
      try {
        // A savepoint, so a collision does not abort the transaction that holds the cart and catalog locks.
        return await tx.transaction((savepoint) =>
          this.orders.insertOrder(savepoint, { ...values, number }),
        );
      } catch (error) {
        if (!isUniqueViolation(error, ORDER_NUMBER_KEY)) {
          throw error;
        }
        // A collision of the 40-bit number: draw another one.
      }
    }
    // Thrown outside the catch on purpose: the unique violation must not travel along as a cause, or the problem filter
    // would answer it as a 409 conflict instead of the loud 500 this is.
    throw new Error(
      `No free order number after ${String(ORDER_NUMBER_ATTEMPTS)} attempts; the number space is damaged or exhausted.`,
    );
  }
}
