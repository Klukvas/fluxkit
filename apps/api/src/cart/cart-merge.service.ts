import { Inject, Injectable } from "@nestjs/common";
import { mergeCarts, type CartLine } from "@fluxkit/core";
import { hashSessionToken } from "../auth/session-token.js";
import type { Transaction } from "../common/transaction.js";
import { CART_CONFIG, cartExpiry, type CartConfig } from "./cart-config.js";
import { CartRepository, type CartRow } from "./cart.repository.js";
import type { CartNoticeResponse } from "./cart.schemas.js";

/** The customer cart can be deleted by its owner between "make sure it exists" and "lock it"; one more round settles it. */
const MAX_ATTEMPTS = 3;

function sameSeen(left: CartLine["seen"], right: CartLine["seen"]): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.amount === right.amount && left.currency === right.currency;
}

/**
 * Merges the guest cart of a request into the cart of the customer who just proved who they are (ADR 0015, plan "Merge at
 * login or registration"). Runs INSIDE the sign-in transaction, which already holds the customer row `FOR UPDATE`: the
 * order customer -> cart that every cart write follows. The two carts are then locked lower id first, so two sign-ins
 * that share a guest cookie (or a sign-in and a cart write) serialize instead of deadlocking, and the second one finds
 * no guest cart. All quantity rules are core's `mergeCarts`; this class only reads, calls it and writes the result.
 */
@Injectable()
export class CartMergeService {
  constructor(
    @Inject(CartRepository) private readonly carts: CartRepository,
    @Inject(CART_CONFIG) private readonly config: CartConfig,
  ) {}

  /**
   * `guestToken` is the `fluxkit_cart` cookie the sign-in request carried. A token that matches no cart (unknown,
   * expired, already merged) merges nothing. Returns the notices of the merge, empty when nothing was capped or dropped.
   */
  async mergeGuestCart(
    transaction: Transaction,
    customerId: string,
    guestToken: string | undefined,
    now: Date,
  ): Promise<CartNoticeResponse[]> {
    if (guestToken === undefined) {
      return [];
    }
    const guestHash = hashSessionToken(guestToken);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const outcome = await this.attempt(transaction, customerId, guestHash, now);
      if (outcome !== "retry") {
        return outcome;
      }
    }
    throw new Error("The customer cart kept disappearing while the guest cart was merged");
  }

  private async attempt(
    transaction: Transaction,
    customerId: string,
    guestHash: string,
    now: Date,
  ): Promise<CartNoticeResponse[] | "retry"> {
    const probe = await this.carts.findByTokenHash(guestHash, transaction);
    if (probe === undefined) {
      return [];
    }
    const expiresAt = cartExpiry(now, this.config);
    if (!(await this.carts.ensureCustomerCart(customerId, now, expiresAt, transaction))) {
      throw new Error("The customer vanished during sign-in");
    }
    const customerProbe = await this.carts.findByCustomerId(customerId, transaction);
    if (customerProbe === undefined) {
      return "retry";
    }
    // Both rows, lower id first. A row that is gone once its lock is granted was deleted by a parallel request.
    const [first, second] = [probe.id, customerProbe.id].sort();
    if (first === undefined || second === undefined) {
      throw new Error("Unreachable: two cart ids");
    }
    const locked = new Map<string, CartRow>();
    for (const id of [first, second]) {
      const row = await this.carts.lockById(id, transaction);
      if (row === undefined) {
        return id === customerProbe.id ? "retry" : [];
      }
      locked.set(id, row);
    }
    const guest = locked.get(probe.id);
    const customerCart = locked.get(customerProbe.id);
    if (guest === undefined || customerCart === undefined) {
      throw new Error("Unreachable: a locked cart is missing");
    }
    if (guest.expiresAt.getTime() <= now.getTime()) {
      // An expired guest cart is no cart.
      await this.carts.deleteCart(guest.id, transaction);
      return [];
    }
    if (customerCart.expiresAt.getTime() <= now.getTime()) {
      await this.carts.deleteLines(customerCart.id, transaction);
    }

    const guestLines = await this.carts.listLines(guest.id, transaction);
    const customerLines =
      customerCart.expiresAt.getTime() <= now.getTime()
        ? []
        : await this.carts.listLines(customerCart.id, transaction);
    const merged = mergeCarts(customerLines, guestLines);

    const before = new Map(customerLines.map((line) => [line.variantId, line]));
    const added: CartLine[] = [];
    const changed: CartLine[] = [];
    for (const line of merged.lines) {
      const existing = before.get(line.variantId);
      if (existing === undefined) {
        added.push(line);
      } else if (existing.quantity !== line.quantity || !sameSeen(existing.seen, line.seen)) {
        changed.push(line);
      }
    }
    await this.carts.updateLines(customerCart.id, changed, now, transaction);
    await this.carts.insertLines(customerCart.id, added, now, transaction);
    await this.carts.deleteCart(guest.id, transaction);
    await this.carts.touch(customerCart.id, now, expiresAt, transaction);
    return merged.notices.map((notice) => ({ code: notice.code }));
  }
}
