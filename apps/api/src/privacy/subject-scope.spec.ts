import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProblemBody } from "../common/problem.filter.js";
import type { PlacedForAdmin } from "../test/admin-orders-world.js";
import { http } from "../test/http.js";
import { Shopper } from "../test/shopper.js";
import { ShipmentWorld, TEST_POINT_REF } from "../test/shipment-world.js";

const PASSWORD = "privacy-scope-pass-phrase-1";

type Row = Record<string, unknown>;

interface ExportDoc {
  orders: { number: string; contact: Record<string, unknown> }[];
  mail: Record<string, unknown>[];
}

/**
 * The scope of a privacy subject (ADR 0035, privacy review F1 to F3) through the real routes on real Postgres: what the
 * self-service export and deletion and the owner's lookup, export, preview and erasure reach, and what they must not.
 */
describe("privacy subject scope (review F1 to F3, real Postgres)", () => {
  const runId = randomBytes(3).toString("hex");
  let world: ShipmentWorld;
  let sequence = 0;

  const owner = () => world.orders.owner;
  const nextEmail = (label: string) => {
    sequence += 1;
    return `scope-${label}-${String(sequence)}-${runId}@example.test`;
  };

  async function pickupOrder(email: string, who?: Shopper): Promise<PlacedForAdmin> {
    const method = world.method.pickup;
    if (method === undefined) throw new Error("Test setup bug: no pickup method");
    return world.orders.place(
      [{ quantity: 1 }],
      {
        email,
        shippingAddress: undefined,
        shipping: { methodCode: method.code, pickupPointRef: TEST_POINT_REF },
      },
      who,
    );
  }

  async function addressOrder(
    email: string,
    contact: { firstName: string; lastName: string; phone: string; line1: string },
    who?: Shopper,
  ): Promise<PlacedForAdmin> {
    const method = world.method.address_no_carrier;
    if (method === undefined) throw new Error("Test setup bug: no address method");
    return world.orders.place(
      [{ quantity: 1 }],
      {
        email,
        firstName: contact.firstName,
        lastName: contact.lastName,
        phone: contact.phone,
        shipping: { methodCode: method.code },
        shippingAddress: {
          countryCode: "UA",
          city: "Kyiv",
          line1: contact.line1,
          recipientFirstName: contact.firstName,
          recipientLastName: contact.lastName,
          recipientPhone: contact.phone,
        },
      },
      who,
    );
  }

  async function cancelled(order: PlacedForAdmin): Promise<PlacedForAdmin> {
    const result = await world.orders.cancel(order.id, "Closed for the test");
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    return order;
  }

  async function register(email: string): Promise<{ shopper: Shopper; id: string }> {
    const shopper = new Shopper(owner().baseUrl);
    const result = await shopper.post<{ customer: { id: string } }>("/store/account/register", {
      email,
      password: PASSWORD,
      firstName: "Scope",
      lastName: "Holder",
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    return { shopper, id: result.body.customer.id };
  }

  /** The holder confirmed the address (what `POST /store/account/verify-email` records). */
  async function verify(customerId: string): Promise<void> {
    await world.pool.query("update customer set email_verified_at = now() where id = $1", [
      customerId,
    ]);
  }

  async function orderRow(id: string): Promise<Row> {
    const result = await world.pool.query<Row>("select * from sales_order where id = $1", [id]);
    const row = result.rows[0];
    if (row === undefined) throw new Error(`order ${id} vanished`);
    return row;
  }

  async function guestMail(to: string): Promise<string> {
    const result = await world.pool.query<{ id: string }>(
      `insert into email_message (template_key, template_version, locale, to_address, recipient_kind, customer_id,
         variables, deadline_at)
       values ('order.placed', 1, 'uk', $1, 'guest', null, '{"number":"X"}', now() + interval '1 hour')
       returning id`,
      [to],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) throw new Error("Test setup bug: no mail row");
    return id;
  }

  async function mailExists(id: string): Promise<boolean> {
    const result = await world.pool.query("select 1 from email_message where id = $1", [id]);
    return result.rowCount === 1;
  }

  const deleteAccount = (shopper: Shopper) =>
    shopper.post<ProblemBody & Row>("/store/account/delete", { password: PASSWORD, confirm: true });

  beforeAll(async () => {
    world = await ShipmentWorld.start({
      rateLimits: {
        checkout: { maxAttempts: 100_000, windowMinutes: 10 },
        accountDelete: { maxAttempts: 100_000, windowMinutes: 60 },
        dataExport: { maxAttempts: 100_000, windowMinutes: 60 },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await world.stop();
  });

  describe("F1: an unverified account reaches its own data only", () => {
    it("R1: an account registered with a guest buyer's address (never verified) neither exports nor erases the guest's orders and mail", async () => {
      const victimEmail = nextEmail("victim");
      const victimOrder = await cancelled(
        await addressOrder(victimEmail, {
          firstName: "Victimfirst",
          lastName: "Victimlast",
          phone: "+380671112233",
          line1: "Victim street 7",
        }),
      );
      const victimMail = await guestMail(victimEmail);
      const before = await orderRow(victimOrder.id);

      // The attacker registers with the victim's address; nothing asks them to confirm it.
      const attacker = await register(victimEmail);
      const me = await attacker.shopper.get<{ customer: { emailVerified: boolean } }>(
        "/store/account/me",
      );
      expect(me.body.customer.emailVerified).toBe(false);

      const exported = await attacker.shopper.get<ExportDoc>("/store/account/data-export");
      expect(exported.status, JSON.stringify(exported.body)).toBe(200);
      expect(exported.body.orders).toEqual([]);
      expect(exported.body.mail).toEqual([]);
      const text = JSON.stringify(exported.body);
      for (const secret of [victimOrder.number, "Victimfirst", "+380671112233", "Victim street"]) {
        expect(text).not.toContain(secret);
      }

      const deleted = await deleteAccount(attacker.shopper);
      expect(deleted.status, JSON.stringify(deleted.body)).toBe(204);
      expect(await orderRow(victimOrder.id)).toEqual(before);
      expect(await mailExists(victimMail)).toBe(true);
      const lookup = await http(owner().baseUrl, "POST", "/store/orders/lookup", {
        body: { number: victimOrder.number, accessToken: victimOrder.accessToken },
      });
      expect(lookup.status).toBe(200);
      const request = await world.pool.query<{ result: Row }>(
        "select result from privacy_request where subject_customer_id = $1 and kind = 'erasure'",
        [attacker.id],
      );
      expect(request.rows[0]?.result).toMatchObject({ ordersAnonymised: 0, mailDeleted: 0 });
    });

    it("a verified account exports and erases the guest orders and guest mail of its address", async () => {
      const email = nextEmail("verified");
      const guestOrder = await cancelled(await pickupOrder(email));
      const mail = await guestMail(email);
      const { shopper, id } = await register(email);
      await verify(id);

      const exported = await shopper.get<ExportDoc>("/store/account/data-export");
      expect(exported.status).toBe(200);
      expect(exported.body.orders.map((order) => order.number)).toEqual([guestOrder.number]);
      expect(exported.body.mail).toHaveLength(1);

      const deleted = await deleteAccount(shopper);
      expect(deleted.status, JSON.stringify(deleted.body)).toBe(204);
      expect(await orderRow(guestOrder.id)).toMatchObject({ email: null, phone: null });
      expect(await mailExists(mail)).toBe(false);
    });
  });
});
