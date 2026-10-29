import { randomBytes } from "node:crypto";
import { and, inArray } from "drizzle-orm";
import { isInPrivacySubjectScope, type PrivacySubjectScope } from "@fluxkit/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProblemBody } from "../common/problem.filter.js";
import { emailMessage, salesOrder } from "../database/schema/index.js";
import type { PlacedForAdmin } from "../test/admin-orders-world.js";
import { http } from "../test/http.js";
import { Shopper } from "../test/shopper.js";
import { ShipmentWorld, TEST_POINT_REF } from "../test/shipment-world.js";
import { subjectMailCondition, subjectOrdersCondition } from "./subject.js";

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

  /** An order mail of a customer's order, sent to the contact address typed at checkout. */
  async function customerMail(to: string, customerId: string): Promise<string> {
    const result = await world.pool.query<{ id: string }>(
      `insert into email_message (template_key, template_version, locale, to_address, recipient_kind, customer_id,
         variables, deadline_at)
       values ('order.placed', 1, 'uk', $1, 'customer', $2, '{"number":"X"}', now() + interval '1 hour')
       returning id`,
      [to, customerId],
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
        registration: { maxAttempts: 100_000, windowMinutes: 60 },
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

  describe("F2: the address reaches guest rows only, never another account's", () => {
    const admin = (path: string, body: unknown) =>
      http<ProblemBody & Row>(owner().baseUrl, "POST", path, { body });

    /** Customer A orders while signed in but types V's address as the contact email; the order is closed. */
    async function accountOrderWithOtherEmail(otherEmail: string) {
      const a = await register(nextEmail("account-a"));
      const order = await cancelled(await pickupOrder(otherEmail, a.shopper));
      expect((await orderRow(order.id)).customer_id).toBe(a.id);
      const mail = await customerMail(otherEmail, a.id);
      return { a, order, mail, before: await orderRow(order.id) };
    }

    it("R2: the owner's request for an address neither exports, previews, erases nor deletes mail of another live account's order that carries it", async () => {
      const victimEmail = nextEmail("typed");
      const { a, order, mail, before } = await accountOrderWithOtherEmail(victimEmail);

      const lookup = await admin("/admin/privacy/lookup", { email: victimEmail });
      expect(lookup.body).toMatchObject({ customer: null, guestOrders: [], mailCount: 0 });

      const created = await admin("/admin/privacy/requests", {
        kind: "erasure",
        subject: { email: victimEmail },
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const id = String(created.body["id"]);
      const exported = await http<ExportDoc>(
        owner().baseUrl,
        "POST",
        `/admin/privacy/requests/${id}/export`,
        { body: { email: victimEmail } },
      );
      expect(exported.status, JSON.stringify(exported.body)).toBe(200);
      expect(exported.body.orders).toEqual([]);
      expect(exported.body.mail).toEqual([]);
      expect(JSON.stringify(exported.body)).not.toContain(order.number);

      const preview = await admin(`/admin/privacy/requests/${id}/erase-preview`, {
        email: victimEmail,
      });
      expect(preview.body).toMatchObject({ accountFound: false, orders: 0, mail: 0, blockers: [] });

      const erased = await admin(`/admin/privacy/requests/${id}/erase`, {
        email: victimEmail,
        confirm: true,
      });
      expect(erased.status, JSON.stringify(erased.body)).toBe(200);
      expect(erased.body).toMatchObject({ result: { ordersAnonymised: 0, mailDeleted: 0 } });
      expect(await orderRow(order.id)).toEqual(before);
      expect(await mailExists(mail)).toBe(true);
      const own = await a.shopper.get<{ contact: Row }>(`/store/account/orders/${order.number}`);
      expect(own.status).toBe(200);
      expect(own.body.contact).toMatchObject({ email: victimEmail, firstName: "Іван" });
    });

    it("R2: a verified account with that address neither exports nor erases another account's order that carries it", async () => {
      const email = nextEmail("verified-holder");
      const { order, mail, before } = await accountOrderWithOtherEmail(email);
      const holder = await register(email);
      await verify(holder.id);

      const exported = await holder.shopper.get<ExportDoc>("/store/account/data-export");
      expect(exported.status).toBe(200);
      expect(exported.body.orders).toEqual([]);
      expect(exported.body.mail).toEqual([]);

      const deleted = await deleteAccount(holder.shopper);
      expect(deleted.status, JSON.stringify(deleted.body)).toBe(204);
      expect(await orderRow(order.id)).toEqual(before);
      expect(await mailExists(mail)).toBe(true);
    });

    it("the SQL conditions select exactly the rows core isInPrivacySubjectScope accepts", async () => {
      const email = nextEmail("matrix");
      const a = await register(nextEmail("matrix-a"));
      const b = await register(nextEmail("matrix-b"));
      const orders = [
        await pickupOrder(email), // guest, the address
        await pickupOrder(nextEmail("matrix-other")), // guest, another address
        await pickupOrder(email, a.shopper), // account A, typed the address
        await pickupOrder(nextEmail("matrix-typed"), a.shopper), // account A, another address
        await pickupOrder(email, b.shopper), // account B, typed the address
      ];
      const ids = orders.map((order) => order.id);
      const mails = [
        await guestMail(email),
        await guestMail(nextEmail("matrix-mail")),
        await customerMail(email, a.id),
        await customerMail(nextEmail("matrix-mail-a"), a.id),
        await customerMail(email, b.id),
      ];
      const scopes: PrivacySubjectScope[] = [
        { customerId: null, guestEmail: email },
        { customerId: a.id, guestEmail: null },
        { customerId: a.id, guestEmail: email },
        { customerId: b.id, guestEmail: email },
      ];
      const db = world.orders.db;
      for (const scope of scopes) {
        const allOrders = await db
          .select({ id: salesOrder.id, customerId: salesOrder.customerId, email: salesOrder.email })
          .from(salesOrder)
          .where(inArray(salesOrder.id, ids));
        const selectedOrders = await db
          .select({ id: salesOrder.id })
          .from(salesOrder)
          .where(and(inArray(salesOrder.id, ids), subjectOrdersCondition(scope)));
        expect(selectedOrders.map((row) => row.id).sort(), JSON.stringify(scope)).toEqual(
          allOrders
            .filter((row) => isInPrivacySubjectScope(scope, row))
            .map((row) => row.id)
            .sort(),
        );
        const allMail = await db
          .select({
            id: emailMessage.id,
            customerId: emailMessage.customerId,
            email: emailMessage.toAddress,
          })
          .from(emailMessage)
          .where(inArray(emailMessage.id, mails));
        const selectedMail = await db
          .select({ id: emailMessage.id })
          .from(emailMessage)
          .where(and(inArray(emailMessage.id, mails), subjectMailCondition(scope)));
        expect(selectedMail.map((row) => row.id).sort(), JSON.stringify(scope)).toEqual(
          allMail
            .filter((row) => isInPrivacySubjectScope(scope, row))
            .map((row) => row.id)
            .sort(),
        );
      }
    });
  });

  describe("F3: only orders in the subject's scope block an erasure", () => {
    it("a stranger's unpaid guest order with my UNVERIFIED address does not block my deletion and stays untouched", async () => {
      const email = nextEmail("unpaid-stranger");
      const { shopper, id } = await register(email);
      // Anyone can place a guest order with my address and leave it awaiting payment.
      const strangers = await pickupOrder(email);
      expect((await orderRow(strangers.id)).status).toBe("awaiting_payment");
      const before = await orderRow(strangers.id);

      const deleted = await deleteAccount(shopper);
      expect(deleted.status, JSON.stringify(deleted.body)).toBe(204);
      expect(JSON.stringify(deleted.body ?? "")).not.toContain(strangers.number);
      expect(await orderRow(strangers.id)).toEqual(before);
      const left = await world.pool.query("select 1 from customer where id = $1", [id]);
      expect(left.rowCount).toBe(0);
    });

    it("another account's open order that carries my verified address does not block my deletion", async () => {
      const email = nextEmail("open-other-account");
      const other = await register(nextEmail("other-account"));
      const open = await pickupOrder(email, other.shopper);
      const before = await orderRow(open.id);
      const holder = await register(email);
      await verify(holder.id);

      const deleted = await deleteAccount(holder.shopper);
      expect(deleted.status, JSON.stringify(deleted.body)).toBe(204);
      expect(await orderRow(open.id)).toEqual(before);
    });

    it("an open guest order with my VERIFIED address is in my scope and blocks (documented: it expires with the payment window)", async () => {
      const email = nextEmail("unpaid-verified");
      const { shopper, id } = await register(email);
      await verify(id);
      const open = await pickupOrder(email);

      const refused = await deleteAccount(shopper);
      expect(refused.status, JSON.stringify(refused.body)).toBe(409);
      expect(refused.body).toMatchObject({
        rule: "erasure_blocked",
        blockers: [{ orderNumber: open.number, reason: "open_order" }],
      });
    });
  });
});
