import { Inject, Injectable } from "@nestjs/common";
import {
  addLine,
  removeLine,
  setLineQuantity,
  type CartLine,
  type CartLinesResult,
  type LineRefusal,
  type Money,
  type StoreLocale,
} from "@fluxkit/core";
import { CLOCK, type Clock } from "../auth/clock.js";
import { generateSessionToken, hashSessionToken } from "../auth/session-token.js";
import { StoreService } from "../catalog/store/store.service.js";
import { findPostgresError } from "../common/postgres-errors.js";
import {
  notFound,
  ruleViolation,
  unauthorized,
  validationFailed,
  type ProblemException,
} from "../common/problem.js";
import { withTransaction, type Transaction } from "../common/transaction.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { CART_CONFIG, cartExpiry, type CartConfig } from "./cart-config.js";
import { CartPricingService } from "./cart-pricing.service.js";
import { CartRepository, type CartRow } from "./cart.repository.js";
import type { AddCartItemBody, CartResponse, SetCartItemQuantityBody } from "./cart.schemas.js";

/** Who a request acts for. There is no cart id anywhere in a request: the cart is found through this and nothing else. */
export type CartOwner =
  | { readonly kind: "customer"; readonly customerId: string }
  | { readonly kind: "guest"; readonly token: string | undefined };

/** What the controller does with the `fluxkit_cart` cookie after the call. */
export type CartCookieDirective =
  | { readonly action: "none" }
  | { readonly action: "set"; readonly token: string }
  | { readonly action: "clear" };

export interface CartOutcome {
  readonly cart: CartResponse;
  readonly cookie: CartCookieDirective;
}

const NO_COOKIE: CartCookieDirective = { action: "none" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VARIANT_FK = "cart_item_variant_id_fkey";

/** A cookie that matched no live cart is dead weight on a write that sets no new cookie: clear it. */
function clearIfPresented(owner: CartOwner): CartCookieDirective {
  return owner.kind === "guest" && owner.token !== undefined ? { action: "clear" } : NO_COOKIE;
}

/** The core refusals of the cart rules as the problems the API documents (docs/api/cart.md). */
function refusalProblem(reason: LineRefusal): ProblemException {
  switch (reason) {
    case "invalid_quantity":
      return validationFailed([
        {
          path: "quantity",
          code: "invalid_quantity",
          message: "Must be a whole number from 1 to 999.",
        },
      ]);
    case "quantity_limit":
      return ruleViolation("A cart line holds at most 999 units.", "quantity_limit");
    case "too_many_lines":
      return ruleViolation("A cart holds at most 100 different variants.", "too_many_lines");
    case "line_not_found":
      return notFound("Cart line");
  }
}

function expectLines(result: CartLinesResult): readonly CartLine[] {
  if (!result.ok) {
    throw refusalProblem(result.reason);
  }
  return result.lines;
}

/** A JSON body can carry anything as a quantity; only a number can be a quantity, the core rule judges the rest. */
function asQuantity(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}

/**
 * The shopper's cart (ADR 0015): guest carts found by the hash of their cookie token, customer carts by the signed-in
 * customer, nothing else. Rules (quantities, limits, line identity, merge) are core; prices, availability and notices are
 * `CartPricingService`; this class is the lifecycle: lazy creation by the first write, the row lock, the sliding
 * expiry and the cookie decision. Every write runs in one transaction that locks the cart row first, and ends with the
 * repriced cart, so a response is always exactly the committed state and an unpriceable result rolls everything back.
 * A cart holds no stock.
 */
@Injectable()
export class CartService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(CartRepository) private readonly carts: CartRepository,
    @Inject(CartPricingService) private readonly pricing: CartPricingService,
    @Inject(StoreService) private readonly store: StoreService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CART_CONFIG) private readonly config: CartConfig,
  ) {}

  /** The cart, repriced. Creates nothing (no row, no cookie): an unknown, expired or missing cart reads as empty. */
  async read(owner: CartOwner, requestedLocale: string | undefined): Promise<CartOutcome> {
    const locale = this.store.resolveLocale(requestedLocale);
    const stored = await this.find(owner);
    if (stored === undefined || this.isExpired(stored)) {
      return { cart: this.pricing.emptyCart(), cookie: NO_COOKIE };
    }
    const lines = await this.carts.listLines(stored.id);
    return { cart: await this.pricing.view(lines, locale, this.db), cookie: NO_COOKIE };
  }

  async addItem(
    owner: CartOwner,
    body: AddCartItemBody,
    requestedLocale: string | undefined,
  ): Promise<CartOutcome> {
    const locale = this.store.resolveLocale(requestedLocale);
    const quantity = asQuantity(body.quantity);
    // A bad quantity is refused before any lookup. Core judges it against an empty cart, so no rule is repeated here.
    expectLines(addLine([], body.variantId, quantity));
    const found = (await this.pricing.lookupPrices([body.variantId], this.db)).get(body.variantId);
    if (found === undefined) {
      throw notFound("Variant");
    }
    if (!found.sellable || found.unitPrice === null) {
      throw ruleViolation("This variant cannot be bought right now.", "variant_not_sellable");
    }
    const unitPrice = found.unitPrice;
    try {
      return await this.write(owner, "create", locale, async (transaction, cart, lines, now) => {
        const next = expectLines(addLine(lines, body.variantId, quantity, unitPrice));
        await this.carts.upsertLine(cart.id, this.lineOf(next, body.variantId), now, transaction);
        return next;
      });
    } catch (error) {
      // The variant was deleted between the lookup and the insert (only never-sold variants can be deleted).
      if (findPostgresError(error)?.constraint === VARIANT_FK) {
        throw notFound("Variant");
      }
      throw error;
    }
  }

  async setQuantity(
    owner: CartOwner,
    variantId: string,
    body: SetCartItemQuantityBody,
    requestedLocale: string | undefined,
  ): Promise<CartOutcome> {
    const locale = this.store.resolveLocale(requestedLocale);
    const quantity = asQuantity(body.quantity);
    expectLines(addLine([], variantId, quantity));
    if (!UUID.test(variantId)) {
      throw notFound("Cart line");
    }
    // The shopper sees the current price when they change a line, so its "price changed" notice ends. A variant that
    // can not be bought keeps the price it was last seen at.
    const found = (await this.pricing.lookupPrices([variantId], this.db)).get(variantId);
    const seen: Money | null = found?.unitPrice ?? null;
    return this.write(owner, "existing", locale, async (transaction, cart, lines, now) => {
      const next = expectLines(setLineQuantity(lines, variantId, quantity, seen));
      await this.carts.updateLines(cart.id, [this.lineOf(next, variantId)], now, transaction);
      return next;
    });
  }

  async removeItem(
    owner: CartOwner,
    variantId: string,
    requestedLocale: string | undefined,
  ): Promise<CartOutcome> {
    const locale = this.store.resolveLocale(requestedLocale);
    if (!UUID.test(variantId)) {
      throw notFound("Cart line");
    }
    return this.write(owner, "existing", locale, async (transaction, cart, lines) => {
      const next = expectLines(removeLine(lines, variantId));
      await this.carts.deleteLine(cart.id, variantId, transaction);
      return next;
    });
  }

  /**
   * Marks the current prices as seen: every line that can be priced gets its current price as `seen`, so its
   * `price_changed` notice ends. Unavailable lines keep what they had. A shopper with no cart gets the empty cart.
   */
  async acknowledge(owner: CartOwner, requestedLocale: string | undefined): Promise<CartOutcome> {
    const locale = this.store.resolveLocale(requestedLocale);
    return this.write(owner, "existing-or-empty", locale, async (transaction, cart, lines, now) => {
      const current = await this.pricing.lookupPrices(
        lines.map((line) => line.variantId),
        transaction,
      );
      let next: readonly CartLine[] = lines;
      const changed: CartLine[] = [];
      for (const line of lines) {
        const price = current.get(line.variantId)?.unitPrice ?? null;
        if (price === null) {
          continue;
        }
        const seen = line.seen;
        if (seen !== null && seen.amount === price.amount && seen.currency === price.currency) {
          continue;
        }
        next = expectLines(setLineQuantity(next, line.variantId, line.quantity, price));
        changed.push(this.lineOf(next, line.variantId));
      }
      await this.carts.updateLines(cart.id, changed, now, transaction);
      return next;
    });
  }

  /** Deletes the whole cart (the next write starts a new one). Creates nothing. A cookie that matched no cart is cleared. */
  async clear(owner: CartOwner): Promise<CartCookieDirective> {
    await withTransaction(this.db, async (transaction) => {
      const locked = await this.lockExisting(owner, transaction);
      if (locked !== undefined) {
        await this.carts.deleteCart(locked.cart.id, transaction);
      }
    });
    return clearIfPresented(owner);
  }

  private lineOf(lines: readonly CartLine[], variantId: string): CartLine {
    const line = lines.find((entry) => entry.variantId === variantId);
    if (line === undefined) {
      throw new Error("The core cart rules returned lines without the changed variant");
    }
    return line;
  }

  /**
   * One write: lock the cart row, let `change` apply a core rule and persist its result, renew the expiry, then price
   * the result in the same transaction. `create` makes the cart on the first write (a refusal rolls the creation
   * back, so a refused write leaves nothing behind); `existing` answers 404 for a missing cart line; `existing-or-empty`
   * is a no-op for a shopper without a cart.
   */
  private async write(
    owner: CartOwner,
    mode: "create" | "existing" | "existing-or-empty",
    locale: StoreLocale,
    change: (
      transaction: Transaction,
      cart: CartRow,
      lines: readonly CartLine[],
      now: Date,
    ) => Promise<readonly CartLine[]>,
  ): Promise<CartOutcome> {
    const now = this.clock.now();
    return withTransaction(this.db, async (transaction) => {
      const locked =
        mode === "create"
          ? await this.lockOrCreate(owner, now, transaction)
          : await this.lockExisting(owner, transaction);
      if (locked === undefined) {
        if (mode === "existing-or-empty") {
          return { cart: this.pricing.emptyCart(), cookie: clearIfPresented(owner) };
        }
        throw notFound("Cart line");
      }
      const lines = await this.carts.listLines(locked.cart.id, transaction);
      const next = await change(transaction, locked.cart, lines, now);
      await this.carts.touch(locked.cart.id, now, cartExpiry(now, this.config), transaction);
      const cart = await this.pricing.view(next, locale, transaction);
      return {
        cart,
        cookie:
          locked.token === undefined ? NO_COOKIE : { action: "set" as const, token: locked.token },
      };
    });
  }

  /**
   * The owner's cart, found through the session or the cookie only, expired ones treated as missing. Guest: the hash of
   * the cookie token. A cookie that matches no cart gets a NEW random token: a token the client chose is never adopted.
   */
  private async lockOrCreate(
    owner: CartOwner,
    now: Date,
    transaction: Transaction,
  ): Promise<{ cart: CartRow; token: string | undefined } | undefined> {
    const expiresAt = cartExpiry(now, this.config);
    if (owner.kind === "customer") {
      if (!(await this.carts.ensureCustomerCart(owner.customerId, now, expiresAt, transaction))) {
        // The account vanished after the session was checked.
        throw unauthorized();
      }
      const row = await this.carts.lockByCustomerId(owner.customerId, transaction);
      if (row === undefined) {
        throw new Error(
          "The customer cart exists after ensureCustomerCart but could not be locked",
        );
      }
      return { cart: await this.dropIfExpired(row, now, transaction), token: undefined };
    }
    if (owner.token !== undefined) {
      const row = await this.carts.lockByTokenHash(hashSessionToken(owner.token), transaction);
      if (row !== undefined) {
        return { cart: await this.dropIfExpired(row, now, transaction), token: owner.token };
      }
    }
    const token = generateSessionToken();
    const row = await this.carts.insertGuest(hashSessionToken(token), now, expiresAt, transaction);
    return { cart: row, token };
  }

  /** An existing, unexpired cart of the owner, locked; `undefined` when there is none (no cart is created). */
  private async lockExisting(
    owner: CartOwner,
    transaction: Transaction,
  ): Promise<{ cart: CartRow; token: string | undefined } | undefined> {
    const now = this.clock.now();
    if (owner.kind === "customer") {
      const row = await this.carts.lockByCustomerId(owner.customerId, transaction);
      return row === undefined || this.isExpired(row, now)
        ? undefined
        : { cart: row, token: undefined };
    }
    if (owner.token === undefined) {
      return undefined;
    }
    const row = await this.carts.lockByTokenHash(hashSessionToken(owner.token), transaction);
    return row === undefined || this.isExpired(row, now)
      ? undefined
      : { cart: row, token: owner.token };
  }

  /** A write to an expired cart starts from nothing: its stale lines go (the owner's own, found by the same token). */
  private async dropIfExpired(row: CartRow, now: Date, transaction: Transaction): Promise<CartRow> {
    if (this.isExpired(row, now)) {
      await this.carts.deleteLines(row.id, transaction);
    }
    return row;
  }

  private isExpired(row: CartRow, now: Date = this.clock.now()): boolean {
    return row.expiresAt.getTime() <= now.getTime();
  }

  private async find(owner: CartOwner): Promise<CartRow | undefined> {
    if (owner.kind === "customer") {
      return this.carts.findByCustomerId(owner.customerId);
    }
    return owner.token === undefined
      ? undefined
      : this.carts.findByTokenHash(hashSessionToken(owner.token));
  }
}
