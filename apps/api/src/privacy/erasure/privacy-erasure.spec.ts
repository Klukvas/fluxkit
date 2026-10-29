import { randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProblemBody } from "../../common/problem.filter.js";
import { PG_POOL } from "../../database/database.module.js";
import { startApp } from "../../test/app.js";
import { PrivacyRetentionService } from "../retention/privacy-retention.service.js";
import type { PlacedForAdmin } from "../../test/admin-orders-world.js";
import { http, type HttpResult } from "../../test/http.js";
import { checkoutAs, checkoutBody } from "../../test/order-http.js";
import { Shopper } from "../../test/shopper.js";
import { ShipmentWorld, TEST_POINT_REF } from "../../test/shipment-world.js";

const PASSWORD = "privacy-erasure-pass-phrase-1";

type Row = Record<string, unknown>;

interface RequestView {
  id: string;
  status: string;
  completedAt: string | null;
  result: Record<string, unknown> | null;
}

/**
 * Erasure (ADR 0033 decision 6, privacy plan step 7) on real Postgres through the real routes: the self-service account
 * deletion and the admin erasure of a request's subject. Blockers refuse and change nothing; a success anonymises the
 * orders' contact fields only and deletes the account, its sessions, cart and tokens and the mail rows.
 */
describe("erasure (privacy plan step 7, real Postgres)", () => {
  const runId = randomBytes(3).toString("hex");
  let world: ShipmentWorld;
  let sequence = 0;

  const owner = () => world.orders.owner;
  const nextEmail = (label: string) => {
    sequence += 1;
    return `erasure-${label}-${String(sequence)}-${runId}@example.test`;
  };

  async function pickupOrder(email: string, who?: Shopper): Promise<PlacedForAdmin> {
    const method = world.method.pickup;
    if (method === undefined) throw new Error("Test setup bug: no pickup method");
    return world.orders.place(
      [{ quantity: 2 }],
      {
        email,
        shippingAddress: undefined,
        shipping: { methodCode: method.code, pickupPointRef: TEST_POINT_REF },
      },
      who,
    );
  }

  async function addressOrder(email: string, who?: Shopper): Promise<PlacedForAdmin> {
    const method = world.method.address_no_carrier;
    if (method === undefined) throw new Error("Test setup bug: no address method");
    return world.orders.place(
      [{ quantity: 1 }],
      {
        email,
        shipping: { methodCode: method.code },
        billingAddress: {
          countryCode: "UA",
          city: "Lviv",
          line1: "Billing street 2",
          recipientFirstName: "Bill",
        },
      },
      who,
    );
  }

  async function cancelled(order: PlacedForAdmin): Promise<PlacedForAdmin> {
    const result = await world.orders.cancel(order.id, "Customer asked by phone");
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    return order;
  }

  async function fulfilled(order: PlacedForAdmin): Promise<PlacedForAdmin> {
    expect((await world.orders.pay(order)).status).toBe(200);
    const result = await world.orders.fulfil(order.id);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    return order;
  }

  async function register(email: string): Promise<{ shopper: Shopper; id: string }> {
    const shopper = new Shopper(owner().baseUrl);
    const result = await shopper.post<{ customer: { id: string } }>("/store/account/register", {
      email,
      password: PASSWORD,
      firstName: "Erase",
      lastName: "Me",
      phone: "+380501112233",
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    return { shopper, id: result.body.customer.id };
  }

  async function orderRow(id: string): Promise<Row> {
    const result = await world.pool.query<Row>("select * from sales_order where id = $1", [id]);
    const row = result.rows[0];
    if (row === undefined) throw new Error(`order ${id} vanished`);
    return row;
  }

  /** Everything an erasure must never change about an order: lines, adjustments, journal, payments, shipments. */
  async function accountingOf(id: string): Promise<unknown> {
    const result = await world.pool.query(
      `select
         (select jsonb_build_object('number', o.number, 'status', o.status, 'locale', o.locale, 'currency', o.currency,
            'subtotal', o.subtotal_amount, 'shipping', o.shipping_total, 'discount', o.discount_total,
            'tax', o.tax_total, 'total', o.total_amount, 'placed', o.placed_at, 'paid', o.paid_at,
            'fulfilled', o.fulfilled_at, 'cancelled', o.cancelled_at, 'expired', o.expired_at,
            'reference', o.payment_reference, 'idempotency', o.idempotency_key)
          from sales_order o where o.id = $1) as header,
         (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') from order_item t where t.order_id = $1) as items,
         (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') from order_adjustment t where t.order_id = $1) as adjustments,
         (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') from order_status_change t where t.order_id = $1) as history,
         (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from order_shipping t where t.order_id = $1) as shipping,
         (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') from shipment t where t.order_id = $1) as shipments,
         (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') from payment t where t.order_id = $1) as payments`,
      [id],
    );
    return result.rows[0];
  }

  async function count(sql: string, values: unknown[]): Promise<number> {
    const result = await world.pool.query<{ count: number }>(
      `select count(*)::int as count from ${sql}`,
      values,
    );
    return result.rows[0]?.count ?? -1;
  }

  async function mailRow(
    to: string,
    customerId: string | null,
    status: "pending" | "sending" | "sent" = "pending",
  ): Promise<string> {
    const result = await world.pool.query<{ id: string }>(
      `insert into email_message (template_key, template_version, locale, to_address, recipient_kind, customer_id,
         variables, deadline_at, status, attempts, lease_until, sent_at, provider_code, provider_message_id)
       values ('order.paid', 1, 'uk', $1, $2, $3, '{"number":"X"}', now() + interval '1 hour', $4,
         case when $4 = 'pending' then 0 else 1 end,
         case when $4 = 'sending' then now() + interval '2 minutes' end,
         case when $4 = 'sent' then now() end,
         case when $4 = 'sent' then 'fake' end,
         case when $4 = 'sent' then 'msg-1' end)
       returning id`,
      [to, customerId === null ? "guest" : "customer", customerId, status],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) throw new Error("Test setup bug: no mail row");
    return id;
  }

  /** Opens the API's pool connections first, so a race really runs at once (payments review F3). */
  async function warmApiPool(connections = 10): Promise<void> {
    const pool = owner().app.get<pg.Pool>(PG_POOL);
    const clients = await Promise.all(Array.from({ length: connections }, () => pool.connect()));
    for (const client of clients) client.release();
  }

  /** Waits until `count` backends of this database wait for a lock held by the test's own connection. */
  async function waitForLockWaiters(count: number, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const waiting = await world.pool.query<{ count: string }>(
        `select count(*) as count from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()`,
      );
      if (Number(waiting.rows[0]?.count) >= count) return;
      if (Date.now() > deadline) {
        throw new Error(`fewer than ${String(count)} transactions ever waited for a lock`);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  /**
   * Holds `lockSql` (first parameter: the customer id) in a transaction of the test, starts `action`, waits until it
   * waits for that lock, runs `meanwhile` in the same transaction and commits: what the action finds under its lock is
   * then the changed state.
   */
  async function whileHolding<T>(
    lockSql: string,
    customerId: string,
    action: () => Promise<T>,
    meanwhile: (client: pg.PoolClient) => Promise<void>,
  ): Promise<T> {
    await warmApiPool();
    const client = await world.pool.connect();
    try {
      await client.query("begin");
      await client.query(lockSql, [customerId]);
      const pending = action();
      try {
        await waitForLockWaiters(1);
        await meanwhile(client);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        await pending.catch(() => undefined);
        throw error;
      }
      return await pending;
    } finally {
      client.release();
    }
  }

  function deleteAccount(
    shopper: Shopper,
    body: unknown = { password: PASSWORD, confirm: true },
  ): Promise<HttpResult<ProblemBody & Row>> {
    return shopper.post<ProblemBody & Row>("/store/account/delete", body);
  }

  beforeAll(async () => {
    world = await ShipmentWorld.start({
      rateLimits: {
        checkout: { maxAttempts: 100_000, windowMinutes: 10 },
        registration: { maxAttempts: 100_000, windowMinutes: 60 },
        accountDelete: { maxAttempts: 100_000, windowMinutes: 60 },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await world.stop();
  });

  describe("POST /store/account/delete", () => {
    it("needs a session, the password and confirm: true; a wrong password changes nothing and counts as a failed sign-in", async () => {
      const anonymous = new Shopper(owner().baseUrl);
      expect((await deleteAccount(anonymous)).status).toBe(401);
      const { shopper, id } = await register(nextEmail("refused"));
      for (const body of [
        { password: PASSWORD },
        { password: PASSWORD, confirm: false },
        { password: PASSWORD, confirm: true, extra: 1 },
        { confirm: true },
      ]) {
        expect((await deleteAccount(shopper, body)).status, JSON.stringify(body)).toBe(400);
      }
      const wrong = await deleteAccount(shopper, { password: "not-the-password-1", confirm: true });
      expect(wrong.status).toBe(400);
      expect(wrong.body.errors).toEqual([
        expect.objectContaining({ path: "password", code: "incorrect" }),
      ]);
      const row = await world.pool.query<{ failed_login_count: number }>(
        "select failed_login_count from customer where id = $1",
        [id],
      );
      expect(row.rows[0]?.failed_login_count).toBe(1);
      expect((await shopper.get("/store/account/me")).status).toBe(200);
    });

    it("refuses with erasure_blocked while an order is open, and changes nothing", async () => {
      const email = nextEmail("blocked");
      const { shopper, id } = await register(email);
      const open = await pickupOrder(email, shopper);
      const before = await orderRow(open.id);
      const refused = await deleteAccount(shopper);
      expect(refused.status, JSON.stringify(refused.body)).toBe(409);
      expect(refused.body).toMatchObject({
        code: "rule_violation",
        rule: "erasure_blocked",
        reasons: ["open_order"],
        blockers: [{ orderNumber: open.number, reason: "open_order" }],
      });
      expect(await orderRow(open.id)).toEqual(before);
      expect(await count("customer where id = $1", [id])).toBe(1);
      expect((await shopper.get("/store/account/me")).status).toBe(200);
    });

    it("refuses with mail_sending while a mail to the subject is being sent", async () => {
      const email = nextEmail("sending");
      const { shopper, id } = await register(email);
      const mail = await mailRow(email, id, "sending");
      const refused = await deleteAccount(shopper);
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ rule: "erasure_blocked", reasons: ["mail_sending"] });
      expect(await count("email_message where id = $1", [mail])).toBe(1);
      await world.pool.query("delete from email_message where id = $1", [mail]);
    });

    it("deletes a verified account and anonymises its orders and the guest orders of its address; accounting data is unchanged", async () => {
      const email = nextEmail("member");
      // A guest order with the same email before the account existed, closed.
      const guestOrder = await cancelled(await addressOrder(email));
      const { shopper, id } = await register(email);
      // Only a verified address reaches the guest orders of the address (ADR 0035; `subject-scope.spec.ts`).
      await world.pool.query("update customer set email_verified_at = now() where id = $1", [id]);
      const own = await fulfilled(await addressOrder(email, shopper));
      const ownCancelled = await cancelled(await pickupOrder(email, shopper));
      const stranger = await cancelled(await addressOrder(nextEmail("stranger")));
      await shopper.post("/store/cart/items", {
        variantId: (await world.orders.catalog.simple({ trackInventory: false, price: 500 }))
          .variantId,
        quantity: 1,
      });
      const mails = [await mailRow(email, id, "sent"), await mailRow(email, null, "pending")];
      const strangerMail = await mailRow(nextEmail("other-mail"), null, "pending");
      const orders = [guestOrder, own, ownCancelled];
      const accounting = await Promise.all(orders.map((order) => accountingOf(order.id)));
      const fingerprints = await Promise.all(
        orders.map(async (order) => (await orderRow(order.id)).request_fingerprint),
      );
      const strangerBefore = await orderRow(stranger.id);

      const deleted = await deleteAccount(shopper);
      expect(deleted.status, JSON.stringify(deleted.body)).toBe(204);
      expect(deleted.headers.getSetCookie().join(";")).toMatch(/fluxkit_customer_session=;/);
      expect((await shopper.get("/store/account/me")).status).toBe(401);
      const login = await new Shopper(owner().baseUrl).post("/store/account/login", {
        email,
        password: PASSWORD,
      });
      expect(login.status).toBe(401);

      expect(await count("customer where id = $1", [id])).toBe(0);
      expect(await count("customer_session where customer_id = $1", [id])).toBe(0);
      expect(await count("cart where customer_id = $1", [id])).toBe(0);
      expect(await count("customer_auth_token where customer_id = $1", [id])).toBe(0);
      expect(await count("email_message where id = any($1)", [mails])).toBe(0);
      expect(await count("email_message where id = $1", [strangerMail])).toBe(1);

      for (const [index, order] of orders.entries()) {
        const row = await orderRow(order.id);
        expect(row).toMatchObject({
          email: null,
          phone: null,
          first_name: null,
          last_name: null,
          cancellation_reason: null,
          access_token_hash: null,
          access_expires_at: null,
          customer_id: null,
        });
        expect(row.contact_erased_at).toBeInstanceOf(Date);
        expect(row.request_fingerprint).toMatch(/^[0-9a-f]{64}$/);
        expect(row.request_fingerprint).not.toBe(fingerprints[index]);
        for (const column of ["shipping_address", "billing_address"]) {
          const value = row[column];
          if (value !== null) expect(value).toEqual({ countryCode: "UA" });
        }
        expect(await accountingOf(order.id), order.number).toEqual(accounting[index]);
        expect(JSON.stringify(row)).not.toContain(email);
        expect(JSON.stringify(row)).not.toMatch(/Billing street|Erase|Customer asked/);
      }
      expect(await orderRow(stranger.id)).toEqual(strangerBefore);

      // The guest link of the old guest order stops working.
      const lookup = await http(owner().baseUrl, "POST", "/store/orders/lookup", {
        body: { number: guestOrder.number, accessToken: guestOrder.accessToken },
      });
      expect(lookup.status).toBe(404);

      const request = await world.pool.query<Row>(
        "select * from privacy_request where subject_customer_id = $1",
        [id],
      );
      expect(request.rows).toHaveLength(1);
      expect(request.rows[0]).toMatchObject({
        kind: "erasure",
        channel: "self_service",
        status: "completed",
        subject_kind: "customer",
      });
      expect(request.rows[0]?.result).toMatchObject({
        ordersAnonymised: 3,
        mailDeleted: 2,
        customerDeleted: true,
        customerId: id,
      });
      expect(
        [...((request.rows[0]?.result as { orderNumbers: string[] }).orderNumbers ?? [])].sort(),
      ).toEqual(orders.map((order) => order.number).sort());
      expect(JSON.stringify(request.rows[0])).not.toContain(email);
    });

    it("lets one of two simultaneous deletions win; the other finds no session", async () => {
      const email = nextEmail("twice");
      const { shopper } = await register(email);
      await world.pool.query("select 1"); // warm the pool before the race
      const results = await Promise.all([deleteAccount(shopper), deleteAccount(shopper)]);
      expect(results.map((result) => result.status).sort()).toEqual([204, 401]);
    });

    it("leaves an order that job 12 already anonymised alone: not anonymised again, not counted (review F6, M1)", async () => {
      const email = nextEmail("pre-erased");
      const { shopper, id } = await register(email);
      const order = await cancelled(await pickupOrder(email, shopper));
      const retention = owner().app.get(PrivacyRetentionService);
      const now = new Date();
      expect(
        await retention.anonymiseIfDue(order.id, new Date(now.getTime() + 24 * 3_600_000), now),
      ).toBe("anonymised");
      const before = await orderRow(order.id);
      expect(before.customer_id).toBe(id);
      expect(before.contact_erased_at).toBeInstanceOf(Date);

      const deleted = await deleteAccount(shopper);
      expect(deleted.status, JSON.stringify(deleted.body)).toBe(204);
      const after = await orderRow(order.id);
      expect(after.contact_erased_at).toEqual(before.contact_erased_at);
      expect(after.request_fingerprint).toBe(before.request_fingerprint);
      const request = await world.pool.query<{ result: Row }>(
        "select result from privacy_request where subject_customer_id = $1 and kind = 'erasure'",
        [id],
      );
      expect(request.rows[0]?.result).toMatchObject({ ordersAnonymised: 0, orderNumbers: [] });
    });

    it("re-checks the account under its lock: a password change or a deactivation after the password check refuses the deletion (review F6, M4)", async () => {
      const other = await register(nextEmail("other-hash"));
      const otherHash = (
        await world.pool.query<{ password_hash: string }>(
          "select password_hash from customer where id = $1",
          [other.id],
        )
      ).rows[0]?.password_hash;
      const changes: [string, string, unknown[]][] = [
        ["password changed", "update customer set password_hash = $2 where id = $1", [otherHash]],
        ["deactivated", "update customer set is_active = false where id = $1", []],
      ];
      for (const [label, change, values] of changes) {
        const { shopper, id } = await register(nextEmail("recheck"));
        const result = await whileHolding(
          "select id from customer where id = $1 for update",
          id,
          () => deleteAccount(shopper),
          async (client) => {
            await client.query(change, [id, ...values]);
          },
        );
        expect(result.status, `${label}: ${JSON.stringify(result.body)}`).toBe(400);
        expect(result.body.errors).toEqual([
          expect.objectContaining({ path: "password", code: "incorrect" }),
        ]);
        expect(await count("customer where id = $1", [id]), label).toBe(1);
      }
    });

    it("is limited per customer (accountDelete) with 429 and Retry-After (review F6, M12)", async () => {
      const limited = await startApp({
        rateLimits: { accountDelete: { maxAttempts: 1, windowMinutes: 60 } },
      });
      try {
        const shopper = new Shopper(limited.baseUrl);
        const registered = await shopper.post<{ customer: { id: string } }>(
          "/store/account/register",
          { email: nextEmail("limited"), password: PASSWORD, firstName: "Rate", lastName: "Limit" },
        );
        expect(registered.status, JSON.stringify(registered.body)).toBe(201);
        const wrong = { password: "not-the-password-1", confirm: true };
        expect((await deleteAccount(shopper, wrong)).status).toBe(400);
        const refused = await deleteAccount(shopper);
        expect(refused.status).toBe(429);
        expect(refused.headers.get("retry-after")).toMatch(/^\d+$/);
        expect(await count("customer where id = $1", [registered.body.customer.id])).toBe(1);
        await world.pool.query("delete from customer where id = $1", [registered.body.customer.id]);
      } finally {
        await limited.app.close();
      }
    });

    it("serializes with a checkout of the same customer: never a deleted account with a live order of it", async () => {
      for (let round = 0; round < 4; round += 1) {
        const email = nextEmail(`race-${String(round)}`);
        const { shopper, id } = await register(email);
        const method = world.method.pickup;
        if (method === undefined) throw new Error("Test setup bug");
        const { variantId } = await world.orders.catalog.simple({
          trackInventory: true,
          onHand: 5,
          price: 1_000,
        });
        expect((await shopper.post("/store/cart/items", { variantId, quantity: 1 })).status).toBe(
          200,
        );
        await world.pool.query("select 1");
        const [checkout, deletion] = await Promise.all([
          checkoutAs(
            shopper,
            checkoutBody(1_000, {
              email,
              shippingAddress: undefined,
              shipping: { methodCode: method.code, pickupPointRef: TEST_POINT_REF },
            }),
          ),
          deleteAccount(shopper),
        ]);
        const placedNumber = checkout.body.order?.number;
        if (placedNumber !== undefined) world.orders.placed.track(placedNumber);
        const customerLeft = await count("customer where id = $1", [id]);
        const liveOrders = await count(
          "sales_order where (customer_id = $1 or email = $2) and contact_erased_at is null",
          [id, email],
        );
        if (deletion.status === 204) {
          expect(customerLeft, JSON.stringify(checkout.body)).toBe(0);
          expect(liveOrders, `round ${String(round)}: checkout ${String(checkout.status)}`).toBe(0);
        } else {
          expect(deletion.status, JSON.stringify(deletion.body)).toBe(409);
          expect(deletion.body).toMatchObject({ rule: "erasure_blocked" });
          expect(checkout.status).toBe(201);
          expect(customerLeft).toBe(1);
        }
      }
    });
  });

  describe("admin erasure of a request", () => {
    async function request(subject: Row, kind = "erasure"): Promise<RequestView> {
      const created = await http<RequestView>(owner().baseUrl, "POST", "/admin/privacy/requests", {
        body: { kind, subject },
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      return created.body;
    }
    const post = (path: string, body: unknown, running = owner()) =>
      http<ProblemBody & Row>(running.baseUrl, "POST", path, { body });
    const view = async (id: string) =>
      (await http<RequestView>(owner().baseUrl, "GET", `/admin/privacy/requests/${id}`)).body;

    it("previews counts and blockers without changing anything", async () => {
      const email = nextEmail("preview");
      const open = await pickupOrder(email);
      const closed = await cancelled(await pickupOrder(email));
      await mailRow(email, null, "pending");
      const created = await request({ email });
      const before = [await orderRow(open.id), await orderRow(closed.id)];
      const preview = await post(`/admin/privacy/requests/${created.id}/erase-preview`, { email });
      expect(preview.status, JSON.stringify(preview.body)).toBe(200);
      expect(preview.body).toEqual({
        accountFound: false,
        orders: 2,
        ordersToAnonymise: 2,
        mail: 1,
        blockers: [{ orderNumber: open.number, reason: "open_order" }],
        reasons: ["open_order"],
      });
      expect([await orderRow(open.id), await orderRow(closed.id)]).toEqual(before);
      expect((await view(created.id)).status).toBe("received");
    });

    it("erases a guest subject by email with confirm, completes the request and answers a repeat with the stored result", async () => {
      const email = nextEmail("guest");
      const orderA = await cancelled(await addressOrder(email));
      const orderB = await fulfilled(await pickupOrder(email));
      const accounting = [await accountingOf(orderA.id), await accountingOf(orderB.id)];
      await mailRow(email, null, "sent");
      const created = await request({ email });
      const path = `/admin/privacy/requests/${created.id}/erase`;
      expect((await post(path, { email })).status).toBe(400);
      expect((await post(path, { confirm: true })).status).toBe(400);
      expect((await post(path, { email: nextEmail("wrong"), confirm: true })).status).toBe(400);
      expect((await post(path, { email, confirm: true }, world.orders.manager)).status).toBe(403);

      const erased = await post(path, { email, confirm: true });
      expect(erased.status, JSON.stringify(erased.body)).toBe(200);
      expect(erased.body).toMatchObject({
        status: "completed",
        result: { ordersAnonymised: 2, mailDeleted: 1, customerDeleted: false },
      });
      for (const order of [orderA, orderB]) {
        expect(await orderRow(order.id)).toMatchObject({ email: null, phone: null });
      }
      expect([await accountingOf(orderA.id), await accountingOf(orderB.id)]).toEqual(accounting);
      expect(await count("email_message where to_address = $1", [email])).toBe(0);

      const again = await post(path, { email, confirm: true });
      expect(again.status).toBe(200);
      expect(again.body).toEqual(erased.body);
      const audit = await world.pool.query<{ action: string }>(
        "select action from admin_audit_event where target_id = $1 order by created_at, id",
        [created.id],
      );
      expect(audit.rows.map((row) => row.action)).toEqual([
        "privacy.request_changed",
        "privacy.erased",
      ]);
    });

    it("refuses a blocked subject with erasure_blocked and keeps the request open", async () => {
      const email = nextEmail("admin-blocked");
      const paid = await world.paid("pickup");
      await world.pool.query("update sales_order set email = $1 where id = $2", [email, paid.id]);
      const shipped = await world.created(paid.id);
      expect(shipped.status).toBe("created");
      const created = await request({ email });
      const refused = await post(`/admin/privacy/requests/${created.id}/erase`, {
        email,
        confirm: true,
      });
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({
        rule: "erasure_blocked",
        reasons: ["open_order", "active_shipment"],
      });
      expect((await orderRow(paid.id)).email).toBe(email);
      expect((await view(created.id)).status).toBe("received");
    });

    it("erases a customer subject: the account goes, its orders are anonymised", async () => {
      const email = nextEmail("admin-customer");
      const { shopper, id } = await register(email);
      const order = await cancelled(await pickupOrder(email, shopper));
      const created = await request({ customerId: id });
      const erased = await post(`/admin/privacy/requests/${created.id}/erase`, { confirm: true });
      expect(erased.status, JSON.stringify(erased.body)).toBe(200);
      expect(erased.body).toMatchObject({
        status: "completed",
        result: { ordersAnonymised: 1, customerDeleted: true, customerId: id },
      });
      expect(await count("customer where id = $1", [id])).toBe(0);
      expect(await orderRow(order.id)).toMatchObject({ email: null, customer_id: null });
      expect((await shopper.get("/store/account/me")).status).toBe(401);
    });

    it("rejects a request with a reason code; a rejected request cannot be erased", async () => {
      const email = nextEmail("reject");
      const created = await request({ email });
      const rejected = await post(`/admin/privacy/requests/${created.id}/reject`, {
        reasonCode: "identity_not_confirmed",
        note: "No reply from the address.",
      });
      expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
      expect(rejected.body).toMatchObject({
        status: "rejected",
        result: { rejectReason: "identity_not_confirmed" },
        note: "No reply from the address.",
      });
      expect(rejected.body.completedAt).not.toBeNull();
      // The rejection is audited in its transaction (review F6, M6).
      const audit = await world.pool.query<{ action: string; detail: Row }>(
        "select action, detail from admin_audit_event where target_id = $1 order by created_at, id",
        [created.id],
      );
      expect(audit.rows).toEqual([
        { action: "privacy.request_changed", detail: { kind: "erasure", toStatus: "received" } },
        {
          action: "privacy.request_changed",
          detail: { toStatus: "rejected", reason: "identity_not_confirmed" },
        },
      ]);
      const erase = await post(`/admin/privacy/requests/${created.id}/erase`, {
        email,
        confirm: true,
      });
      expect(erase.status).toBe(409);
      expect(erase.body).toMatchObject({ rule: "request_closed" });
      expect(
        (await post(`/admin/privacy/requests/${created.id}/reject`, { reasonCode: "duplicate" }))
          .status,
      ).toBe(409);
      expect(
        (await post(`/admin/privacy/requests/${created.id}/reject`, { reasonCode: "Not A Code" }))
          .status,
      ).toBe(400);
    });

    it("refuses to erase with an export request (kind export), also once it is completed", async () => {
      const email = nextEmail("kind");
      const order = await cancelled(await pickupOrder(email));
      const created = await request({ email }, "export");
      const erase = () =>
        post(`/admin/privacy/requests/${created.id}/erase`, { email, confirm: true });
      const refused = await erase();
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ rule: "not_an_erasure_request" });
      // A completed EXPORT request is not an erasure answered again (the idempotency guard checks the kind; M9).
      expect((await post(`/admin/privacy/requests/${created.id}/export`, { email })).status).toBe(
        200,
      );
      expect((await view(created.id)).status).toBe("completed");
      const again = await erase();
      expect(again.status, JSON.stringify(again.body)).toBe(409);
      expect(again.body).toMatchObject({ rule: "not_an_erasure_request" });
      expect((await orderRow(order.id)).email).toBe(email);
    });

    it("refuses with refund_in_progress while a refund is not settled (review F6, M7)", async () => {
      const email = nextEmail("refund");
      const order = await cancelled(await pickupOrder(email));
      const paymentId = (
        await world.pool.query<{ id: string }>(
          `insert into payment (order_id, provider_code, provider_payment_id, amount, currency, status, expires_at,
             created_by, refunded_amount)
           values ($1, 'fake', 'p-' || $2, 1000, 'UAH', 'succeeded', now() + interval '1 day', 'admin', 0)
           returning id`,
          [order.id, randomUUID().slice(0, 8)],
        )
      ).rows[0]?.id;
      await world.pool.query(
        `insert into payment_refund (payment_id, amount, currency, payment_amount, reason, status)
         values ($1, 1000, 'UAH', 1000, 'admin', 'requested')`,
        [paymentId],
      );
      try {
        const created = await request({ email });
        const preview = await post(`/admin/privacy/requests/${created.id}/erase-preview`, {
          email,
        });
        expect(preview.body).toMatchObject({
          blockers: [{ orderNumber: order.number, reason: "refund_in_progress" }],
          reasons: ["refund_in_progress"],
        });
        const refused = await post(`/admin/privacy/requests/${created.id}/erase`, {
          email,
          confirm: true,
        });
        expect(refused.status, JSON.stringify(refused.body)).toBe(409);
        expect(refused.body).toMatchObject({
          rule: "erasure_blocked",
          reasons: ["refund_in_progress"],
        });
        expect((await orderRow(order.id)).email).toBe(email);
      } finally {
        await world.pool.query("delete from payment_refund where payment_id = $1", [paymentId]);
        await world.pool.query("delete from payment where id = $1", [paymentId]);
      }
    });

    it("locks the customer first: an order that becomes the customer's while the row is held is erased too (review F6, M5)", async () => {
      const email = nextEmail("admin-lock");
      const { id } = await register(email);
      // A closed order of someone else that becomes this customer's while a checkout-like writer holds the row.
      const late = await cancelled(await pickupOrder(nextEmail("late")));
      const created = await request({ customerId: id });
      const erased = await whileHolding(
        "select id from customer where id = $1 for key share",
        id,
        () => post(`/admin/privacy/requests/${created.id}/erase`, { confirm: true }),
        async (client) => {
          // A customer's order has no guest access (sales_order_customer_or_token_check).
          await client.query(
            `update sales_order set customer_id = $1, access_token_hash = null, access_expires_at = null
             where id = $2`,
            [id, late.id],
          );
        },
      );
      expect(erased.status, JSON.stringify(erased.body)).toBe(200);
      expect(erased.body).toMatchObject({
        result: { ordersAnonymised: 1, orderNumbers: [late.number], customerDeleted: true },
      });
      expect(await orderRow(late.id)).toMatchObject({ email: null, customer_id: null });
      expect((await orderRow(late.id)).contact_erased_at).toBeInstanceOf(Date);
    });
  });

  describe("erased orders downstream", () => {
    it("refuses a shipment of an erased order with contact_erased and changes nothing", async () => {
      const paid = await world.paid("pickup");
      await world.pool.query(
        `update sales_order set email = null, phone = null, first_name = null, last_name = null,
           access_token_hash = null, access_expires_at = null, contact_erased_at = now() where id = $1`,
        [paid.id],
      );
      const result = await world.create(paid.id);
      expect(result.status, JSON.stringify(result.body)).toBe(409);
      expect(result.body).toMatchObject({ code: "rule_violation", rule: "contact_erased" });
      expect(await count("shipment where order_id = $1", [paid.id])).toBe(0);
    });

    it("shows an erased order to the admin with null contact fields and contactErasedAt", async () => {
      const email = nextEmail("view");
      const order = await cancelled(await pickupOrder(email));
      const created = await http<RequestView>(owner().baseUrl, "POST", "/admin/privacy/requests", {
        body: { kind: "erasure", subject: { email } },
      });
      expect(
        (
          await http(owner().baseUrl, "POST", `/admin/privacy/requests/${created.body.id}/erase`, {
            body: { email, confirm: true },
          })
        ).status,
      ).toBe(200);
      const detail = await world.orders.get(`/admin/orders/${order.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body).toMatchObject({
        contact: { email: null, phone: null, firstName: null, lastName: null },
        shippingAddress: null,
        billingAddress: null,
      });
      expect((detail.body as { contactErasedAt: string | null }).contactErasedAt).not.toBeNull();
    });
  });
});
