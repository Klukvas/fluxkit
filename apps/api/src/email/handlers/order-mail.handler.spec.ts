import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ORDER_READ_PORT,
  type AdminOrderView,
  type DomainEventEnvelope,
  type OrderReadPort,
} from "@fluxkit/core";
import { CLOCK } from "../../auth/clock.js";
import { LOCALE_CONFIG } from "../../common/locale.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { dispatchDomainEvents } from "../../jobs/dispatch-domain-events.job.js";
import { DomainEventHandlerRegistry } from "../../jobs/domain-event-handlers.js";
import { pgEventLeaseSource } from "../../jobs/event-leases.js";
import { JobsRepository } from "../../jobs/jobs.repository.js";
import { JobsRunner } from "../../jobs/jobs-runner.js";
import { createTestCustomer, deleteTestCustomers } from "../../test/customer-fixtures.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import { Shopper } from "../../test/shopper.js";
import type { PlaceLine, PlacedForAdmin } from "../../test/admin-orders-world.js";
import { ShipmentWorld } from "../../test/shipment-world.js";
import { captureLogs } from "../../test/shipping-fixtures.js";
import { testEmailProviders, type TestEmailProvider } from "../../test/test-email-provider.js";
import { startApp } from "../../test/app.js";
import {
  EMAIL_DELIVERY_CONFIG,
  EMAIL_SEND_PACER,
  EmailLinkUnavailableError,
  EmailMessageChanges,
  EmailOutbox,
  EmailSender,
} from "../outbox/index.js";
import { EmailTemplateRegistry } from "../templates/index.js";
import { EmailProviderRegistry } from "../registry/index.js";
import { OrderMailHandler } from "./order-mail.handler.js";

interface MailRow {
  id: string;
  template_key: string;
  locale: string;
  to_address: string;
  recipient_kind: string;
  customer_id: string | null;
  order_id: string | null;
  variables: Record<string, unknown>;
  dedupe_key: string | null;
  status: string;
}

const PASSWORD = "correct horse battery staple";
const HOSTILE_TITLE = `<script>alert(1)</script>"><img src=x onerror=alert(2)>&`;
const LINK =
  /https:\/\/shop\.example\.com\/[a-z]{2}\/(?:order|account\/orders)\/[0-9A-Z-]+(?:#t=[A-Za-z0-9_-]+)?/;

describe("order and shipment mails (real Postgres, domain events, the in-repo test email provider)", () => {
  let world: ShipmentWorld;
  const customers: string[] = [];

  const owner = () => world.orders.owner;
  const database = () => owner().app.get<Database>(DRIZZLE);
  const provider = () => owner().app.get(EmailProviderRegistry).get() as TestEmailProvider;
  const runner = () => owner().app.get(JobsRunner);
  const pool = () => world.pool;

  /** One tick (events, then mail) at the fake clock: the same code the scheduler runs. */
  async function tick(): Promise<void> {
    const reports = await runner().runAll(world.clock.now());
    for (const report of reports) {
      expect(report.ok, JSON.stringify(report)).toBe(true);
    }
  }

  async function mails(orderId: string): Promise<MailRow[]> {
    const result = await pool().query<MailRow>(
      `select id, template_key, locale, to_address, recipient_kind, customer_id, order_id, variables, dedupe_key, status
         from email_message where order_id = $1 order by created_at, template_key`,
      [orderId],
    );
    return result.rows;
  }

  async function eventsOf(aggregateId: string, type: string): Promise<{ id: string }[]> {
    const result = await pool().query<{ id: string }>(
      "select id from domain_event where aggregate_id = $1 and type = $2",
      [aggregateId, type],
    );
    return result.rows;
  }

  /** A guest order (or the shopper's) with the address method that has no carrier, so a spec can set the email and locale. */
  function placeOrder(
    lines: PlaceLine[] = [{ quantity: 1 }],
    overrides: Record<string, unknown> = {},
    who?: Shopper,
  ): Promise<PlacedForAdmin> {
    const method = world.method.address_no_carrier;
    if (method === undefined) {
      throw new Error("Test setup bug: no method");
    }
    return world.orders.place(lines, { shipping: { methodCode: method.code }, ...overrides }, who);
  }

  async function signedInShopper(): Promise<{ shopper: Shopper; id: string; email: string }> {
    const account = await createTestCustomer(database(), { password: PASSWORD });
    customers.push(account.id);
    const shopper = new Shopper(owner().baseUrl);
    const signedIn = await shopper.post("/store/account/login", {
      email: account.email,
      password: PASSWORD,
    });
    expect(signedIn.status).toBe(200);
    return { shopper, id: account.id, email: account.email };
  }

  beforeAll(async () => {
    world = await ShipmentWorld.start({
      extraEmailProviders: testEmailProviders(),
      emailDeliveryTuning: { sendTimeoutMs: 500, sendsPerSecond: 1_000 },
    });
  });

  beforeEach(async () => {
    // Events other spec files left undelivered are not this spec's business; the clock stands ahead of the database's
    // `now()` so every event written during a test is due.
    await pool().query("delete from domain_event where dispatched_at is null");
    await pool().query("delete from email_message");
    provider().reset();
    world.clock.set(new Date(Date.now() + 60_000));
  });

  afterAll(async () => {
    try {
      await pool().query("delete from email_message");
      await deleteTestCustomers(database(), customers);
    } finally {
      await world.stop();
    }
  });

  describe("order.placed", () => {
    it("a guest order enqueues exactly one confirmation with the recipient, locale, frozen variables and the dedupe key, and sends it with a working guest link", async () => {
      const placed = await placeOrder(
        [{ quantity: 2, price: 150_050, productTitle: { uk: "Ковдра", en: "Blanket" } }],
        { locale: "en" },
      );
      const logs = captureLogs();
      try {
        await tick();
      } finally {
        logs.stop();
      }
      const rows = await mails(placed.id);
      expect(rows).toHaveLength(1);
      const [row] = rows as [MailRow];
      const [event] = (await eventsOf(placed.id, "order.placed")) as [{ id: string }];
      expect(row).toMatchObject({
        template_key: "order.placed",
        locale: "en",
        to_address: placed.email,
        recipient_kind: "guest",
        customer_id: null,
        order_id: placed.id,
        dedupe_key: `${event.id}:order.placed`,
        status: "sent",
      });
      expect(row.variables).toMatchObject({
        orderNumber: placed.number,
        currency: "UAH",
        lines: [{ title: "Blanket", variantTitle: null, quantity: 2, lineTotal: 300_100 }],
        moreLines: 0,
        subtotal: 300_100,
        shipping: 0,
        discount: 0,
        total: 300_100,
      });
      // Frozen variables hold no link, no token, no address, no phone.
      const frozen = JSON.stringify(row.variables);
      expect(frozen).not.toContain(placed.accessToken);
      expect(frozen).not.toContain("http");
      expect(frozen).not.toContain(placed.email);
      expect(frozen).not.toContain("+380");

      // The mail itself: rendered at send time, money from minor units, plain-text part, the guest link with the token.
      expect(provider().sent).toHaveLength(1);
      const sent = provider().sent[0]?.message;
      expect(sent?.to.address).toBe(placed.email);
      expect(sent?.subject).toContain(placed.number);
      expect(sent?.text).toContain("3001.00 UAH");
      expect(sent?.text).toContain("Blanket");
      expect(sent?.html).toContain("3001.00 UAH");
      const link = LINK.exec(sent?.text ?? "")?.[0] ?? "";
      expect(link).toBe(
        `https://shop.example.com/en/order/${placed.number}#t=${placed.accessToken}`,
      );

      // The derived token is the one checkout handed out and the order accepts it.
      const lookup = await new Shopper(owner().baseUrl).post("/store/orders/lookup", {
        number: placed.number,
        accessToken: placed.accessToken,
      });
      expect(lookup.status).toBe(200);
      // Logs: codes and ids only, never the address, the token, the link or a title.
      const text = logs.text();
      for (const secret of [
        placed.email,
        placed.accessToken,
        "Blanket",
        "shop.example.com/en/order",
      ]) {
        expect(text).not.toContain(secret);
      }
    });

    it("a customer's order goes to the order's email with the account order link and no token", async () => {
      const { shopper, id, email } = await signedInShopper();
      const placed = await placeOrder(
        [{ quantity: 1, price: 40_000 }],
        { email: undefined },
        shopper,
      );
      await tick();
      const rows = await mails(placed.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        template_key: "order.placed",
        locale: "uk",
        recipient_kind: "customer",
        customer_id: id,
        status: "sent",
      });
      expect(rows[0]?.to_address).toBe(email.toLowerCase());
      const sent = provider().sent[0]?.message;
      expect(sent?.text).toContain(`https://shop.example.com/uk/account/orders/${placed.number}`);
      expect(sent?.text).not.toContain("#t=");
      expect(sent?.subject).toContain(placed.number);
    });

    it("prints the pickup point and the shipping method of the snapshot, and the payment deadline while it applies", async () => {
      const placed = await world.place("pickup");
      await tick();
      const sent = provider().sent[0]?.message;
      expect(sent?.text).toMatch(/Пункт видачі/);
      expect(sent?.text).toMatch(/UTC/);
      const [row] = await mails(placed.id);
      expect(row?.variables).toMatchObject({
        delivery: { pickupPoint: { number: expect.any(String) } },
        payBefore: expect.stringMatching(/^20\d\d-/),
      });
    });

    it("escapes a hostile product title in the HTML and keeps the plain-text part", async () => {
      const placed = await placeOrder([
        { quantity: 1, productTitle: { uk: HOSTILE_TITLE, en: HOSTILE_TITLE } },
      ]);
      await tick();
      const sent = provider().sent[0]?.message;
      expect(sent?.html).not.toContain("<script>alert(1)</script>");
      expect(sent?.html).not.toContain("<img src=x");
      expect(sent?.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(sent?.text).toContain(HOSTILE_TITLE);
      expect(await mails(placed.id)).toHaveLength(1);
    });

    it("lists at most the first lines and counts the rest, so the variables stay small", async () => {
      const lines = Array.from({ length: 14 }, () => ({ quantity: 1, price: 100 }));
      const placed = await placeOrder(lines);
      await tick();
      const [row] = await mails(placed.id);
      expect((row?.variables["lines"] as unknown[]).length).toBe(12);
      expect(row?.variables["moreLines"]).toBe(2);
      expect(provider().sent[0]?.message.text).toContain("Ще позицій у замовленні: 2");
    });
  });

  describe("the other events", () => {
    it("order.paid, order.cancelled, order.expired and shipment.created each enqueue one mail and nothing else is mailed", async () => {
      const paidOrder = await world.paid("pickup");
      await tick();
      expect((await mails(paidOrder.id)).map((row) => row.template_key)).toEqual([
        "order.paid",
        "order.placed",
      ]);
      const paidMail = provider().sent.find((entry) => entry.message.subject.includes("отримано"));
      expect(paidMail?.message.text).toContain("10.00 UAH");
      expect(paidMail?.message.text).toContain(
        `https://shop.example.com/uk/order/${paidOrder.number}#t=${paidOrder.accessToken}`,
      );

      const shipment = await world.created(paidOrder.id);
      await world.orders.fulfil(paidOrder.id);
      await tick();
      const afterShipping = await mails(paidOrder.id);
      expect(afterShipping.map((row) => row.template_key).sort()).toEqual([
        "order.paid",
        "order.placed",
        "shipment.created",
      ]);
      const shipped = afterShipping.find((row) => row.template_key === "shipment.created");
      expect(shipped?.variables).toMatchObject({
        orderNumber: paidOrder.number,
        trackingNumber: shipment.trackingNumber,
      });
      expect(shipped?.recipient_kind).toBe("guest");
      const text = provider().sent.find((entry) => entry.message.subject.includes("перевізнику"))
        ?.message.text;
      expect(text).toContain(shipment.trackingNumber ?? "never");
      // `order.fulfilled` and `shipment.status_changed` mail nothing in v1.
      expect(await eventsOf(paidOrder.id, "order.fulfilled")).toHaveLength(1);

      const cancelled = await world.place("pickup");
      const cancelResult = await world.orders.cancel(cancelled.id);
      expect(cancelResult.status).toBe(200);
      await tick();
      expect((await mails(cancelled.id)).map((row) => row.template_key).sort()).toEqual([
        "order.cancelled",
        "order.placed",
      ]);
      const cancelMail = provider().sent.find((entry) =>
        entry.message.subject.includes("скасовано"),
      );
      expect(cancelMail?.message.text).toContain(cancelled.number);
      expect(cancelMail?.message.text).not.toContain("#t=");

      const expiring = await world.place("pickup");
      world.clock.advanceMinutes(45);
      await tick();
      expect((await mails(expiring.id)).map((row) => row.template_key).sort()).toEqual([
        "order.expired",
        "order.placed",
      ]);
    });
  });

  describe("redelivery and the dedupe key", () => {
    it("a redelivered event never makes a second row, by the dispatcher or by a direct call", async () => {
      const placed = await placeOrder();
      await tick();
      expect(await mails(placed.id)).toHaveLength(1);
      const [event] = (await eventsOf(placed.id, "order.placed")) as [{ id: string }];

      // The event is delivered again (a handler of the same event failed, or a dispatcher died before the mark).
      await pool().query(
        "update domain_event set dispatched_at = null, attempts = 0 where id = $1",
        [event.id],
      );
      await tick();
      expect(await mails(placed.id)).toHaveLength(1);
      expect(
        (
          await pool().query(
            "select 1 from domain_event where id = $1 and dispatched_at is not null",
            [event.id],
          )
        ).rowCount,
      ).toBe(1);

      const handler = owner().app.get(OrderMailHandler);
      const envelope: DomainEventEnvelope = {
        id: event.id,
        type: "order.placed",
        aggregateId: placed.id,
        payload: { orderId: placed.id, orderNumber: placed.number, status: "awaiting_payment" },
        occurredAt: new Date(),
        previousFailures: 1,
      };
      await handler.handle(envelope);
      await handler.handle(envelope);
      expect(await mails(placed.id)).toHaveLength(1);
      expect(provider().sent).toHaveLength(1);
    });

    it("a mail for a second template of the same event is a different row (the key is event and template)", async () => {
      const placed = await placeOrder();
      await tick();
      const [row] = await mails(placed.id);
      const [event] = (await eventsOf(placed.id, "order.placed")) as [{ id: string }];
      expect(row?.dedupe_key).toBe(`${event.id}:order.placed`);
      const handler = owner().app.get(OrderMailHandler);
      await handler.handle({
        id: event.id,
        type: "order.paid",
        aggregateId: placed.id,
        payload: { orderId: placed.id, orderNumber: placed.number, status: "paid" },
        occurredAt: new Date(),
        previousFailures: 0,
      });
      expect((await mails(placed.id)).map((entry) => entry.dedupe_key).sort()).toEqual(
        [`${event.id}:order.paid`, `${event.id}:order.placed`].sort(),
      );
    });
  });

  describe("when no mail is sent", () => {
    it("EMAIL_PROVIDER=none: the handler does not even read the order, and no row is written", async () => {
      const none = await startApp();
      try {
        const placed = await placeOrder();
        const reads: string[] = [];
        const spy: OrderReadPort = {
          getOrder: (id) => {
            reads.push(id);
            return Promise.resolve(undefined);
          },
        };
        const handler = new OrderMailHandler(
          spy,
          none.app.get(EmailOutbox),
          none.app.get<Database>(DRIZZLE),
          none.app.get(CLOCK),
          none.app.get(LOCALE_CONFIG),
        );
        const logs = captureLogs();
        try {
          await handler.handle({
            id: randomUUID(),
            type: "order.placed",
            aggregateId: placed.id,
            payload: { orderId: placed.id, orderNumber: placed.number, status: "awaiting_payment" },
            occurredAt: new Date(),
            previousFailures: 0,
          });
        } finally {
          logs.stop();
        }
        expect(reads).toEqual([]);
        expect(await mails(placed.id)).toEqual([]);
        // The whole application without a provider: a tick delivers the events and writes no mail.
        await none.app.get(JobsRunner).runAll(world.clock.now());
        expect(await mails(placed.id)).toEqual([]);
        expect(logs.text()).not.toContain(placed.email);
      } finally {
        await none.app.close();
      }
    });

    it("an address no mail header can carry: no row, a code-only log, the event is still delivered", async () => {
      const placed = await placeOrder([{ quantity: 1 }], { email: "покупець@example.test" });
      const logs = captureLogs();
      try {
        await tick();
      } finally {
        logs.stop();
      }
      expect(await mails(placed.id)).toEqual([]);
      expect(provider().sent).toEqual([]);
      expect(logs.text()).toMatch(/order\.placed not enqueued: the recipient address is/);
      expect(logs.text()).not.toContain("покупець");
      const events = await pool().query(
        "select dispatched_at from domain_event where aggregate_id = $1 and type = 'order.placed'",
        [placed.id],
      );
      expect(events.rows[0]?.dispatched_at).not.toBeNull();
    });

    it("an order without an email, an order that no longer exists and a shipment without a tracking number are skipped with a code", async () => {
      const placed = await placeOrder();
      const real = owner().app.get<OrderReadPort>(ORDER_READ_PORT);
      const view = (await real.getOrder(placed.id)) as AdminOrderView;
      const port = (answer: AdminOrderView | undefined): OrderReadPort => ({
        getOrder: () => Promise.resolve(answer),
      });
      const handlerWith = (answer: AdminOrderView | undefined) =>
        new OrderMailHandler(
          port(answer),
          owner().app.get(EmailOutbox),
          database(),
          owner().app.get(CLOCK),
          owner().app.get(LOCALE_CONFIG),
        );
      const envelope = (type: string, payload: Record<string, unknown>): DomainEventEnvelope => ({
        id: randomUUID(),
        type,
        aggregateId: placed.id,
        payload,
        occurredAt: new Date(),
        previousFailures: 0,
      });
      const order = { orderId: placed.id, orderNumber: placed.number, status: "paid" };
      const logs = captureLogs();
      try {
        await handlerWith({ ...view, contact: { ...view.contact, email: "  " } }).handle(
          envelope("order.paid", order),
        );
        await handlerWith(undefined).handle(envelope("order.paid", order));
        await handlerWith(view).handle(
          envelope("shipment.created", { ...order, shipmentId: randomUUID(), status: "created" }),
        );
      } finally {
        logs.stop();
      }
      expect(await mails(placed.id)).toEqual([]);
      expect(logs.text()).toContain("no_recipient");
      expect(logs.text()).toContain("order_not_found");
      expect(logs.text()).toContain("no_tracking_number");
      expect(logs.text()).not.toContain(placed.email);
    });

    it("an order whose contact was erased (ADR 0033) is never mailed: no_recipient, no row", async () => {
      const placed = await placeOrder();
      const real = owner().app.get<OrderReadPort>(ORDER_READ_PORT);
      const view = (await real.getOrder(placed.id)) as AdminOrderView;
      const erased: AdminOrderView = {
        ...view,
        contact: { email: null, phone: null, firstName: null, lastName: null },
        contactErasedAt: new Date().toISOString(),
      };
      const handler = new OrderMailHandler(
        { getOrder: () => Promise.resolve(erased) },
        owner().app.get(EmailOutbox),
        database(),
        owner().app.get(CLOCK),
        owner().app.get(LOCALE_CONFIG),
      );
      const logs = captureLogs();
      try {
        for (const type of ["order.placed", "order.paid", "order.cancelled"]) {
          await handler.handle({
            id: randomUUID(),
            type,
            aggregateId: placed.id,
            payload: { orderId: placed.id, orderNumber: placed.number, status: "paid" },
            occurredAt: new Date(),
            previousFailures: 0,
          });
        }
      } finally {
        logs.stop();
      }
      expect(await mails(placed.id)).toEqual([]);
      expect(logs.text().match(/no_recipient/g)).toHaveLength(3);
    });

    it("a malformed payload fails loudly (the event is retried), never a silent skip", async () => {
      const handler = owner().app.get(OrderMailHandler);
      await expect(
        handler.handle({
          id: randomUUID(),
          type: "order.paid",
          aggregateId: randomUUID(),
          payload: { orderId: "not-a-uuid" },
          occurredAt: new Date(),
          previousFailures: 0,
        }),
      ).rejects.toThrow(RangeError);
    });
  });

  describe("currencies with another exponent", () => {
    it.each([
      ["JPY", 1_500, "1500 JPY"],
      ["KWD", 12_345, "12.345 KWD"],
    ])(
      "an order in %s is stored in minor units and printed with its exponent",
      async (currency, amount, text) => {
        const placed = await placeOrder();
        const real = owner().app.get<OrderReadPort>(ORDER_READ_PORT);
        const view = (await real.getOrder(placed.id)) as AdminOrderView;
        const money = { amount, currency };
        const foreign: AdminOrderView = {
          ...view,
          currency,
          subtotal: money,
          shippingTotal: { amount: 0, currency },
          discountTotal: { amount: 0, currency },
          total: money,
          items: view.items.map((item) => ({
            ...item,
            unitPrice: money,
            lineTotal: money,
            quantity: 1,
          })),
        };
        const handler = new OrderMailHandler(
          { getOrder: () => Promise.resolve(foreign) },
          owner().app.get(EmailOutbox),
          database(),
          owner().app.get(CLOCK),
          owner().app.get(LOCALE_CONFIG),
        );
        await handler.handle({
          id: randomUUID(),
          type: "order.placed",
          aggregateId: placed.id,
          payload: { orderId: placed.id, orderNumber: placed.number, status: "awaiting_payment" },
          occurredAt: new Date(),
          previousFailures: 0,
        });
        const [row] = await mails(placed.id);
        expect(row?.variables).toMatchObject({ currency, total: amount });
        const report = await owner()
          .app.get(EmailSender)
          .attempt(row?.id ?? "", () => world.clock.now());
        expect(report.kind).toBe("sent");
        expect(provider().sent.at(-1)?.message.text).toContain(`Разом: ${text}`);
      },
    );
  });

  describe("failures", () => {
    it("a handler that fails does not block the other handlers or events; the event is retried and the mail is made once", async () => {
      const placed = await placeOrder();
      const [event] = (await eventsOf(placed.id, "order.placed")) as [{ id: string }];
      const calls: string[] = [];
      const real = owner().app.get<OrderReadPort>(ORDER_READ_PORT);
      let failing = true;
      const flaky = new OrderMailHandler(
        {
          getOrder: (id) =>
            failing ? Promise.reject(new Error("read port down")) : real.getOrder(id),
        },
        owner().app.get(EmailOutbox),
        database(),
        owner().app.get(CLOCK),
        owner().app.get(LOCALE_CONFIG),
      );
      const deps = {
        database: database(),
        repository: owner().app.get(JobsRepository),
        handlers: {
          handlersFor: (type: string) =>
            type === "order.placed"
              ? [
                  { name: "OrderMailHandler", handler: flaky },
                  {
                    name: "Recorder",
                    handler: {
                      handle: (envelope: DomainEventEnvelope) => {
                        calls.push(envelope.id);
                        return Promise.resolve();
                      },
                    },
                  },
                ]
              : [],
        },
        leases: pgEventLeaseSource(requireTestDatabaseUrl()),
      };
      const first = await dispatchDomainEvents(deps, world.clock.now());
      expect(first.failures).toEqual([
        {
          eventId: event.id,
          type: "order.placed",
          handler: "OrderMailHandler",
          code: expect.any(String),
        },
      ]);
      expect(first).toMatchObject({ dispatched: 0, failed: 1 });
      expect(calls).toEqual([event.id]);
      expect(await mails(placed.id)).toEqual([]);

      failing = false;
      world.clock.advanceMinutes(2);
      const second = await dispatchDomainEvents(deps, world.clock.now());
      expect(second).toMatchObject({ dispatched: 1, failed: 0 });
      expect(await mails(placed.id)).toHaveLength(1);
      expect(
        owner()
          .app.get(DomainEventHandlerRegistry)
          .handlersFor("order.placed")
          .map((entry) => entry.name),
      ).toContain("OrderMailHandler");
    });

    it("a temporary failure to read the order for the link is not the mail's failure: it stays leased and the next claim sends it", async () => {
      const placed = await placeOrder();
      await dispatchDomainEvents(
        {
          database: database(),
          repository: owner().app.get(JobsRepository),
          handlers: owner().app.get(DomainEventHandlerRegistry),
          leases: pgEventLeaseSource(requireTestDatabaseUrl()),
        },
        world.clock.now(),
      );
      const [row] = (await mails(placed.id)) as [MailRow];
      expect(row.status).toBe("pending");
      const app = owner().app;
      const real = app.get(EmailSender);
      const unavailable = new EmailSender(
        app.get(EmailProviderRegistry),
        app.get(EmailTemplateRegistry),
        app.get(EmailMessageChanges),
        app.get(EMAIL_DELIVERY_CONFIG),
        { linksFor: () => Promise.reject(new EmailLinkUnavailableError()) },
        app.get(LOCALE_CONFIG),
        app.get(CLOCK),
        app.get(EMAIL_SEND_PACER),
      );
      await expect(unavailable.attempt(row.id, () => world.clock.now())).rejects.toBeInstanceOf(
        EmailLinkUnavailableError,
      );
      expect((await mails(placed.id))[0]?.status).toBe("sending");
      expect(provider().calls).toEqual([]);
      world.clock.advanceMinutes(3);
      expect(await real.attempt(row.id, () => world.clock.now())).toMatchObject({ kind: "sent" });
      expect(provider().sent).toHaveLength(1);
    });

    it("a mail whose guest link cannot be derived fails render_failed instead of sending a dead link", async () => {
      const placed = await placeOrder();
      await tick();
      const [row] = await mails(placed.id);
      await pool().query(
        "update sales_order set access_token_hash = repeat('0', 64) where id = $1",
        [placed.id],
      );
      await pool().query("delete from email_message where id = $1", [row?.id]);
      provider().reset();
      const handler = owner().app.get(OrderMailHandler);
      const [event] = (await eventsOf(placed.id, "order.placed")) as [{ id: string }];
      await handler.handle({
        id: event.id,
        type: "order.placed",
        aggregateId: placed.id,
        payload: { orderId: placed.id, orderNumber: placed.number, status: "awaiting_payment" },
        occurredAt: new Date(),
        previousFailures: 0,
      });
      const [again] = await mails(placed.id);
      const logs = captureLogs();
      let report;
      try {
        report = await owner()
          .app.get(EmailSender)
          .attempt(again?.id ?? "", () => world.clock.now());
      } finally {
        logs.stop();
      }
      expect(report).toMatchObject({ kind: "failed" });
      expect(provider().sent).toEqual([]);
      expect(logs.text()).toContain("render_failed");
    });
  });

  describe("a stored mail of the largest size", () => {
    it("is accepted by the database variables limit", async () => {
      const placed = await placeOrder();
      const text = "😀".repeat(100);
      const big = {
        orderNumber: placed.number,
        currency: "UAH",
        lines: Array.from({ length: 12 }, () => ({
          title: text,
          variantTitle: text,
          quantity: 999,
          lineTotal: 1_000_000_000_000,
        })),
        moreLines: 88,
        subtotal: 1_000_000_000_000,
        shipping: 1_000_000_000_000,
        discount: 1_000_000_000_000,
        total: 1_000_000_000_000,
        delivery: {
          methodTitle: text,
          pickupPoint: { number: text, city: text, description: text },
          city: null,
        },
        payBefore: "2030-01-01T00:00:00.000Z",
      };
      const result = await database().transaction((tx) =>
        owner().app.get(EmailOutbox).enqueue(tx, {
          templateKey: "order.placed",
          locale: "uk",
          to: placed.email,
          recipientKind: "guest",
          orderId: placed.id,
          variables: big,
          now: world.clock.now(),
        }),
      );
      expect(result.status).toBe("enqueued");
    });
  });
});
