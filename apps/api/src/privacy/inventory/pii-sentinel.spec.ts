import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JobsRunner } from "../../jobs/jobs-runner.js";
import { PaymentProviderRegistry } from "../../payments/registry/index.js";
import { ShipmentWorld } from "../../test/shipment-world.js";
import { captureLogs } from "../../test/shipping-fixtures.js";
import {
  TEST_PAYMENT_PROVIDER_CODE,
  testPaymentProviders,
  type TestPaymentProvider,
} from "../../test/test-payment-provider.js";
import { testEmailProviders } from "../../test/test-email-provider.js";
import { http, type HttpResult } from "../../test/http.js";
import { Shopper } from "../../test/shopper.js";
import {
  codeColumns,
  rowsContaining,
  sentinelSubject,
  sentinelsIn,
  type SentinelSubject,
} from "../../test/pii-sentinel.js";
import { ADDRESS } from "../../test/order-http.js";
import { coreInventory, listSchemaTables } from "./index.js";

const PASSWORD = "sentinel-pass-phrase-correct-horse";
const ALLOWED_COOKIES = new Set([
  "fluxkit_cart",
  "fluxkit_customer_session",
  "fluxkit_admin_session",
]);

/**
 * The PII sentinel guard (ADR 0033 decision 12; plan step 2). A world registers, checks out as a guest and as a customer,
 * pays through the test payment provider, creates a shipment, sends the mails and then lets a stranger probe the same
 * addresses. Sentinel values must appear in no log line, no domain event, no error-code column, no problem body of another
 * subject and no database column that the inventory does not classify as personal data.
 */
describe("PII sentinel guard (real Postgres, test providers, the real checkout, payment, shipment and mail code)", () => {
  const runId = randomBytes(3).toString("hex");
  const guest = sentinelSubject(1, runId);
  const member = sentinelSubject(2, runId);
  let world: ShipmentWorld;
  let logText = "";
  const setCookies: string[] = [];
  const strangerBodies: string[] = [];
  const tokens: string[] = [];

  const owner = () => world.orders.owner;
  const note = <T extends HttpResult>(result: T): T => {
    setCookies.push(...result.headers.getSetCookie());
    return result;
  };
  /** A shopper that records every Set-Cookie header it receives, also those of helpers that call it. */
  class NotingShopper extends Shopper {
    override async request<TBody = unknown>(
      method: Parameters<Shopper["request"]>[0],
      path: string,
      options?: Parameters<Shopper["request"]>[2],
    ): Promise<HttpResult<TBody>> {
      return note(await super.request<TBody>(method, path, options));
    }
  }
  const contact = (subject: SentinelSubject) => ({
    email: subject.email,
    phone: subject.phone,
    firstName: subject.firstName,
    lastName: subject.lastName,
    shippingAddress: { ...ADDRESS, line1: subject.addressLine },
  });

  beforeAll(async () => {
    world = await ShipmentWorld.start({
      extraEmailProviders: testEmailProviders(),
      extraPaymentProviders: testPaymentProviders(),
      paymentCallTimeoutMs: 500,
      emailDeliveryTuning: { sendTimeoutMs: 500, sendsPerSecond: 1_000 },
    });
    await world.pool.query("delete from domain_event where dispatched_at is null");
    world.clock.set(new Date(Date.now() + 60_000));
    const method = world.method.address_carrier;
    if (method === undefined) throw new Error("Test setup bug: no carrier method");
    const provider = owner()
      .app.get(PaymentProviderRegistry)
      .get(TEST_PAYMENT_PROVIDER_CODE) as TestPaymentProvider;
    const logs = captureLogs();
    try {
      // 1. A guest order, paid through the provider and its webhook, then shipped.
      const guestShopper = new NotingShopper(owner().baseUrl);
      const placed = await world.orders.place(
        [{ quantity: 1 }],
        { ...contact(guest), shipping: { methodCode: method.code } },
        guestShopper,
      );
      tokens.push(placed.accessToken);
      const started = await guestShopper.request<{ paymentId?: string }>(
        "POST",
        "/store/orders/payments",
        {
          body: { number: placed.number, accessToken: placed.accessToken },
          headers: { "idempotency-key": randomUUID() },
        },
      );
      expect(started.status, JSON.stringify(started.body)).toBe(201);
      const invoice = provider.invoices.at(-1);
      if (invoice === undefined) throw new Error("Test setup bug: no invoice");
      provider.setStatus(invoice.providerPaymentId, "succeeded");
      const webhook = provider.webhookFor(invoice.providerPaymentId);
      const delivered = await fetch(
        `${owner().baseUrl}/webhooks/payments/${TEST_PAYMENT_PROVIDER_CODE}`,
        { method: "POST", headers: webhook.headers, body: Buffer.from(webhook.rawBody) },
      );
      expect(delivered.status).toBe(200);
      const created = await world.created(placed.id);
      expect(created.status).toBe("created");

      // 2. A customer: registers, orders, asks for a reset, signs out and in again.
      const buyer = new NotingShopper(owner().baseUrl);
      const registered = await buyer.post("/store/account/register", {
        email: member.email,
        password: PASSWORD,
        firstName: member.firstName,
        lastName: member.lastName,
        phone: member.phone,
      });
      expect(registered.status, JSON.stringify(registered.body)).toBe(201);
      const order = await world.orders.place(
        [{ quantity: 2 }],
        { ...contact(member), shipping: { methodCode: method.code } },
        buyer,
      );
      tokens.push(order.accessToken);
      await buyer.get("/store/account/me");
      await buyer.get("/store/account/orders");
      await buyer.post("/store/account/password-reset", { email: member.email });
      await buyer.post("/store/account/logout");
      await buyer.post("/store/account/login", { email: member.email, password: PASSWORD });

      // 3. A stranger probes the addresses and the order numbers of both subjects.
      const stranger = new NotingShopper(owner().baseUrl);
      const probes: HttpResult[] = [
        await stranger.post("/store/orders/lookup", {
          number: placed.number,
          accessToken: "wrong-token",
        }),
        await stranger.post("/store/orders/cancel", {
          number: placed.number,
          accessToken: "wrong-token",
        }),
        await stranger.post("/store/orders/payments/status", {
          number: placed.number,
          accessToken: "wrong-token",
          paymentId: randomUUID(),
        }),
        await stranger.post("/store/account/register", {
          email: member.email,
          password: PASSWORD,
          firstName: "Other",
          lastName: "Person",
        }),
        await stranger.post("/store/account/login", {
          email: member.email,
          password: "wrong-pass-phrase-1",
        }),
        await stranger.post("/store/account/login", {
          email: guest.email,
          password: "wrong-pass-phrase-1",
        }),
        await stranger.post("/store/account/password-reset", { email: guest.email }),
        await stranger.post("/store/account/password-reset", { email: member.email }),
        await stranger.post("/store/account/password-reset/confirm", {
          token: "not-a-real-token",
          newPassword: PASSWORD,
        }),
      ];
      for (const probe of probes) {
        strangerBodies.push(JSON.stringify(probe.body ?? null));
        expect(probe.status).toBeGreaterThanOrEqual(200);
      }

      // 4. Staff change the account, the jobs deliver the events and send the mails.
      const customerId = (
        await world.pool.query<{ id: string }>("select id from customer where email = $1", [
          member.email,
        ])
      ).rows[0]?.id;
      expect(customerId).toBeDefined();
      for (const isActive of [false, true]) {
        const changed = await http(owner().baseUrl, "PATCH", `/admin/customers/${customerId}`, {
          body: { isActive },
        });
        expect(changed.status, JSON.stringify(changed.body)).toBe(200);
      }
      expect((await world.orders.get(`/admin/orders/${order.id}`)).status).toBe(200);
      const reports = await owner().app.get(JobsRunner).runAll(world.clock.now());
      for (const report of reports) expect(report.ok, JSON.stringify(report)).toBe(true);
    } finally {
      logs.stop();
    }
    logText = logs.text();
  }, 60_000);

  afterAll(async () => {
    try {
      await world.pool.query("delete from email_message");
      await world.pool.query("delete from customer where email = $1", [member.email]);
    } finally {
      await world.stop();
    }
  });

  const everything = () => [
    ...guest.values,
    ...member.values,
    ...tokens.filter((token) => token !== ""),
    PASSWORD,
  ];

  it("did exercise the flows (the scan below is not vacuous)", async () => {
    const orders = await world.pool.query<{ n: string }>(
      "select count(*)::text as n from sales_order where email = any($1)",
      [[guest.email, member.email]],
    );
    expect(Number(orders.rows[0]?.n)).toBe(2);
    const mails = await world.pool.query<{ n: string }>(
      "select count(*)::text as n from email_message where to_address = any($1)",
      [[guest.email, member.email]],
    );
    expect(Number(mails.rows[0]?.n)).toBeGreaterThan(0);
    const payments = await world.pool.query<{ n: string }>(
      "select count(*)::text as n from payment where status = 'succeeded'",
    );
    expect(Number(payments.rows[0]?.n)).toBeGreaterThan(0);
    expect(logText.length).toBeGreaterThan(0);
  });

  it("writes no sentinel, token or password into any log line", () => {
    expect(sentinelsIn(logText, everything())).toEqual([]);
  });

  it("writes no sentinel into a domain event payload or aggregate id", async () => {
    const rows = await world.pool.query<{ text: string }>(
      "select (type || ' ' || aggregate_id::text || ' ' || payload::text) as text from domain_event",
    );
    expect(rows.rowCount).toBeGreaterThan(0);
    expect(sentinelsIn(rows.rows.map((row) => row.text).join("\n"), everything())).toEqual([]);
  });

  it("writes no sentinel into an error-code column (and finds the code columns it scans)", async () => {
    const columns = await codeColumns(world.pool);
    expect(columns.length).toBeGreaterThanOrEqual(4);
    for (const { table, column } of columns) {
      expect(
        await rowsContaining(world.pool, table, [column], everything()),
        `${table}.${column}`,
      ).toBe(0);
    }
  });

  it("returns no sentinel in the problem body of a request about another subject", () => {
    expect(strangerBodies.length).toBeGreaterThan(5);
    expect(sentinelsIn(strangerBodies.join("\n"), everything())).toEqual([]);
  });

  it("keeps sentinels out of every column the inventory does not classify as personal data", async () => {
    const guarded: string[] = [];
    for (const table of listSchemaTables()) {
      const entries = coreInventory[table.name] ?? {};
      const columns = table.columns.filter((column) => {
        const dataClass = entries[column]?.class;
        return dataClass !== "personal" && dataClass !== "staff";
      });
      guarded.push(...columns.map((column) => `${table.name}.${column}`));
      expect(await rowsContaining(world.pool, table.name, columns, guest.values), table.name).toBe(
        0,
      );
      expect(await rowsContaining(world.pool, table.name, columns, member.values), table.name).toBe(
        0,
      );
    }
    expect(guarded.length).toBeGreaterThan(300);
  });

  it("freezes no contact data into the mail variables", async () => {
    const rows = await world.pool.query<{ variables: unknown }>(
      "select variables from email_message where to_address = any($1)",
      [[guest.email, member.email]],
    );
    expect(rows.rowCount).toBeGreaterThan(0);
    expect(sentinelsIn(JSON.stringify(rows.rows), everything())).toEqual([]);
  });

  it("sets only the three documented cookies, each HttpOnly, SameSite and path-scoped", () => {
    const names = new Set<string>();
    for (const header of setCookies) {
      const [pair, ...attributes] = header.split("; ");
      const name = pair?.split("=")[0] ?? "";
      names.add(name);
      expect(ALLOWED_COOKIES.has(name), `unexpected cookie ${name}`).toBe(true);
      expect(attributes).toContain("HttpOnly");
      expect(attributes.some((attribute) => /^SameSite=(Lax|Strict)$/.test(attribute))).toBe(true);
      expect(attributes.some((attribute) => /^Path=\/(store|admin)$/.test(attribute))).toBe(true);
    }
    expect(names.has("fluxkit_cart")).toBe(true);
    expect(names.has("fluxkit_customer_session")).toBe(true);
  });
});
