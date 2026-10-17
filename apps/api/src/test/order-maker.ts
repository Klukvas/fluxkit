import type pg from "pg";
import { expect } from "vitest";
import type { CartCatalog } from "./cart-fixtures.js";
import type { PlacedOrders } from "./order-fixtures.js";
import { checkoutAs, checkoutBody, orderRow } from "./order-http.js";
import { Shopper } from "./shopper.js";

/** TEST ONLY. An order placed through the real checkout, with what a spec needs to look at it afterwards. */
export interface MadeOrder {
  id: string;
  number: string;
  total: number;
  accessToken: string;
  lines: { variantId: string; productId: string; quantity: number }[];
}

export interface MadeLine {
  quantity: number;
  price?: number;
  onHand?: number;
}

/** TEST ONLY. Places guest orders of tracked, tracked-stock products through `POST /store/checkout`. */
export class OrderMaker {
  constructor(
    private readonly catalog: CartCatalog,
    private readonly placed: PlacedOrders,
    private readonly pool: pg.Pool,
    private readonly baseUrl: () => string,
  ) {}

  async place(lines: MadeLine[] = [{ quantity: 1 }]): Promise<MadeOrder> {
    const who = new Shopper(this.baseUrl());
    const made: MadeOrder["lines"] = [];
    let total = 0;
    for (const line of lines) {
      const { variantId, productId } = await this.catalog.simple({
        trackInventory: true,
        onHand: line.onHand ?? 50,
        price: line.price ?? 1_000,
      });
      const added = await who.post("/store/cart/items", { variantId, quantity: line.quantity });
      expect(added.status, JSON.stringify(added.body)).toBe(200);
      total += line.quantity * (line.price ?? 1_000);
      made.push({ variantId, productId, quantity: line.quantity });
    }
    const result = await checkoutAs(who, checkoutBody(total));
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    const number = this.placed.track(result.body.order?.number ?? "");
    return {
      id: (await orderRow(this.pool, number)).id,
      number,
      total,
      accessToken: result.body.accessToken ?? "",
      lines: made,
    };
  }
}
