import { randomBytes, randomUUID } from "node:crypto";
import { findForbiddenExportKeys, PERSONAL_DATA_EXPORT_FORMAT } from "@fluxkit/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProblemBody } from "../../common/problem.filter.js";
import { http } from "../../test/http.js";
import { Shopper } from "../../test/shopper.js";
import { ShipmentWorld, TEST_POINT_REF } from "../../test/shipment-world.js";
import type { PlacedForAdmin } from "../../test/admin-orders-world.js";

const PASSWORD = "privacy-export-pass-phrase-1";

interface ExportDoc {
  format: string;
  generatedAt: string;
  subject: { kind: string };
  account: Record<string, unknown> | null;
  orders: {
    number: string;
    contact: Record<string, unknown>;
    lines: Record<string, unknown>[];
    shipments: Record<string, unknown>[];
    statusHistory: Record<string, unknown>[];
    shippingMethod: Record<string, unknown> | null;
  }[];
  mail: Record<string, unknown>[];
  sessions: Record<string, unknown>[];
  cart: { lines: Record<string, unknown>[] } | null;
  processors: { kind: string; name: string }[];
}

interface RequestView {
  id: string;
  kind: string;
  subjectKind: string;
  subjectCustomerId: string | null;
  channel: string;
  status: string;
  dueAt: string;
  receivedAt: string;
  completedAt: string | null;
  overdue: boolean;
  result: Record<string, unknown> | null;
  note: string | null;
  handledBy: string | null;
}

describe("personal data export and the admin privacy requests (privacy plan step 6, real Postgres)", () => {
  const runId = randomBytes(3).toString("hex");
  const memberEmail = `privacy-member-${runId}@example.test`;
  const loneEmail = `privacy-guest-${runId}@example.test`;
  let world: ShipmentWorld;
  let member: Shopper;
  let memberId = "";
  let guestOrderOfMember: PlacedForAdmin;
  let memberOrder: PlacedForAdmin;
  let loneOrder: PlacedForAdmin;
  let strangerOrder: PlacedForAdmin;

  const owner = () => world.orders.owner;
  const admin = (path: string, body?: unknown, running = owner()) =>
    http<Record<string, unknown> & ProblemBody>(running.baseUrl, "POST", path, { body });

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

  async function auditActions(targetId: string): Promise<string[]> {
    const result = await world.pool.query<{ action: string }>(
      "select action from admin_audit_event where target_id = $1 order by created_at, id",
      [targetId],
    );
    return result.rows.map((row) => row.action);
  }

  beforeAll(async () => {
    world = await ShipmentWorld.start({
      rateLimits: {
        checkout: { maxAttempts: 100_000, windowMinutes: 10 },
        dataExport: { maxAttempts: 3, windowMinutes: 24 * 60 },
      },
    });
    // A guest order with the member's address, placed before the account exists: paid and shipped.
    guestOrderOfMember = await pickupOrder(memberEmail);
    expect((await world.orders.pay(guestOrderOfMember)).status).toBe(200);
    await world.created(guestOrderOfMember.id);
    // The member registers and orders as a customer.
    member = new Shopper(owner().baseUrl);
    const registered = await member.post<{ customer: { id: string } }>("/store/account/register", {
      email: memberEmail,
      password: PASSWORD,
      firstName: "Privacy",
      lastName: "Member",
    });
    expect(registered.status, JSON.stringify(registered.body)).toBe(201);
    memberId = registered.body.customer.id;
    memberOrder = await pickupOrder(memberEmail, member);
    // A guest who never had an account, and a stranger.
    loneOrder = await pickupOrder(loneEmail);
    strangerOrder = await pickupOrder(`privacy-stranger-${runId}@example.test`);
  }, 60_000);

  afterAll(async () => {
    await world.stop();
  });

  describe("GET /store/account/data-export", () => {
    it("needs a customer session", async () => {
      const anonymous = new Shopper(owner().baseUrl);
      expect((await anonymous.get("/store/account/data-export")).status).toBe(401);
    });

    it("downloads the member's account, own orders and guest orders with the same email, never a stranger's", async () => {
      const result = await member.get<ExportDoc>("/store/account/data-export");
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(result.headers.get("cache-control")).toBe("no-store");
      expect(result.headers.get("content-disposition")).toMatch(
        /^attachment; filename="personal-data-\d{4}-\d{2}-\d{2}\.json"$/,
      );
      const doc = result.body;
      expect(Object.keys(doc)).toEqual([
        "format",
        "generatedAt",
        "subject",
        "account",
        "orders",
        "mail",
        "sessions",
        "cart",
        "processors",
      ]);
      expect(doc.format).toBe(PERSONAL_DATA_EXPORT_FORMAT);
      expect(doc.subject).toEqual({ kind: "customer" });
      expect(doc.account).toMatchObject({
        email: memberEmail,
        firstName: "Privacy",
        lastName: "Member",
      });
      expect(doc.orders.map((order) => order.number).sort()).toEqual(
        [guestOrderOfMember.number, memberOrder.number].sort(),
      );
      const shipped = doc.orders.find((order) => order.number === guestOrderOfMember.number);
      expect(shipped?.shipments).toHaveLength(1);
      expect(shipped?.statusHistory.map((entry) => entry.toStatus)).toEqual([
        "awaiting_payment",
        "paid",
      ]);
      expect(shipped?.contact).toMatchObject({ email: memberEmail });
      expect(shipped?.shippingMethod).toMatchObject({ kind: "pickup_point" });
      expect(doc.sessions.length).toBeGreaterThanOrEqual(1);
      expect(doc.processors).toContainEqual({ kind: "shipping", name: "fake" });
      const text = JSON.stringify(doc);
      expect(text).not.toContain(strangerOrder.number);
      expect(text).not.toContain(loneOrder.number);
    });

    it("contains no hash, secret, token or internal id at any depth", async () => {
      const result = await member.get<ExportDoc>("/store/account/data-export");
      expect(result.status).toBe(200);
      expect(findForbiddenExportKeys(result.body)).toEqual([]);
      const rows = await world.pool.query<Record<string, string>>(
        `select id, access_token_hash, request_fingerprint, idempotency_key::text from sales_order
         where number = any($1)`,
        [[guestOrderOfMember.number, memberOrder.number]],
      );
      const text = JSON.stringify(result.body);
      for (const row of rows.rows) {
        for (const value of Object.values(row)) {
          if (value !== null) expect(text).not.toContain(value);
        }
      }
      expect(text).not.toContain(guestOrderOfMember.accessToken);
      expect(text).not.toContain(memberId);
      expect(text).not.toContain("scrypt$");
    });

    it("records a completed self-service export request without contact data", async () => {
      const rows = await world.pool.query<Record<string, unknown>>(
        "select * from privacy_request where subject_customer_id = $1 and channel = 'self_service'",
        [memberId],
      );
      expect(rows.rows.length).toBeGreaterThanOrEqual(1);
      for (const row of rows.rows) {
        expect(row).toMatchObject({
          kind: "export",
          status: "completed",
          subject_kind: "customer",
        });
        expect(JSON.stringify(row)).not.toContain(memberEmail);
      }
    });

    it("is limited per customer (dataExport) with 429 and Retry-After", async () => {
      // Two exports above, the third is the last allowed one in this world's window of 3.
      expect((await member.get("/store/account/data-export")).status).toBe(200);
      const refused = await member.get<ProblemBody>("/store/account/data-export");
      expect(refused.status).toBe(429);
      expect(refused.headers.get("retry-after")).toMatch(/^\d+$/);
    });
  });

  describe("POST /admin/privacy/lookup", () => {
    it("finds the account, its guest orders, the mail count and open requests; audited", async () => {
      const result = await admin("/admin/privacy/lookup", {
        email: ` ${memberEmail.toUpperCase()} `,
      });
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(result.body.customer).toMatchObject({
        id: memberId,
        email: memberEmail,
        orderCount: 1,
      });
      expect(
        (result.body.guestOrders as { number: string; contactErased: boolean }[]).map((order) => [
          order.number,
          order.contactErased,
        ]),
      ).toEqual([[guestOrderOfMember.number, false]]);
      expect(typeof result.body.mailCount).toBe("number");
      expect(await auditActions(memberId)).toContain("privacy.lookup");
    });

    it("answers an address without an account with its guest orders; the audit names the admin", async () => {
      const result = await admin("/admin/privacy/lookup", { email: loneEmail });
      expect(result.status).toBe(200);
      expect(result.body.customer).toBeNull();
      expect(
        (result.body.guestOrders as { number: string }[]).map((order) => order.number),
      ).toEqual([loneOrder.number]);
      expect(await auditActions(world.orders.ownerId)).toContain("privacy.lookup");
    });

    it("refuses an invalid email and an unknown field, and has no GET form", async () => {
      expect((await admin("/admin/privacy/lookup", { email: "not-an-email" })).status).toBe(400);
      expect((await admin("/admin/privacy/lookup", { email: loneEmail, q: 1 })).status).toBe(400);
      const get = await http(owner().baseUrl, "GET", `/admin/privacy/lookup?email=${loneEmail}`);
      expect(get.status).toBe(404);
    });
  });

  describe("permissions: privacy.manage is the owner's only", () => {
    it.each([
      ["POST", "/admin/privacy/lookup"],
      ["GET", "/admin/privacy/requests"],
      ["POST", "/admin/privacy/requests"],
      ["GET", `/admin/privacy/requests/${randomUUID()}`],
      ["POST", `/admin/privacy/requests/${randomUUID()}/export`],
    ] as const)("%s %s: manager and viewer 403, anonymous 401", async (method, path) => {
      for (const [running, status] of [
        [world.orders.manager, 403],
        [world.orders.viewer, 403],
        [world.orders.anonymous, 401],
      ] as const) {
        const result = await http(running.baseUrl, method, path, {
          ...(method === "POST" ? { body: { email: loneEmail } } : {}),
        });
        expect(result.status, `${method} ${path}`).toBe(status);
      }
    });
  });

  describe("privacy requests", () => {
    it("records a request by email (HMAC only), due in 30 days; audited", async () => {
      const created = await http<RequestView>(owner().baseUrl, "POST", "/admin/privacy/requests", {
        body: { kind: "export", subject: { email: loneEmail }, note: "Replied from the address." },
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.headers.get("location")).toBe(`/admin/privacy/requests/${created.body.id}`);
      expect(created.body).toMatchObject({
        kind: "export",
        subjectKind: "email",
        subjectCustomerId: null,
        channel: "admin",
        status: "received",
        overdue: false,
        handledBy: world.orders.ownerId,
      });
      expect(Date.parse(created.body.dueAt) - Date.parse(created.body.receivedAt)).toBe(
        30 * 86_400_000,
      );
      const row = await world.pool.query<Record<string, unknown>>(
        "select * from privacy_request where id = $1",
        [created.body.id],
      );
      expect(JSON.stringify(row.rows[0])).not.toContain(loneEmail);
      expect(row.rows[0]?.subject_email_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(await auditActions(created.body.id)).toEqual(["privacy.request_changed"]);
      const read = await http<RequestView>(
        owner().baseUrl,
        "GET",
        `/admin/privacy/requests/${created.body.id}`,
      );
      expect(read.body).toEqual(created.body);
    });

    it("refuses an unknown customer (404), a bad body (400) and an unknown request (404)", async () => {
      const unknown = await http(owner().baseUrl, "POST", "/admin/privacy/requests", {
        body: { kind: "export", subject: { customerId: randomUUID() } },
      });
      expect(unknown.status).toBe(404);
      for (const body of [
        { kind: "access", subject: { email: loneEmail } },
        { kind: "export", subject: { email: loneEmail, customerId: memberId } },
        { kind: "export", subject: { email: "nope" } },
        { kind: "export", subject: { email: loneEmail }, note: "" },
      ]) {
        const result = await http(owner().baseUrl, "POST", "/admin/privacy/requests", { body });
        expect(result.status, JSON.stringify(body)).toBe(400);
      }
      expect(
        (await http(owner().baseUrl, "GET", `/admin/privacy/requests/${randomUUID()}`)).status,
      ).toBe(404);
    });

    it("lists open requests first by due date, then closed ones; filters by status", async () => {
      const list = await http<{ items: RequestView[]; total: number }>(
        owner().baseUrl,
        "GET",
        "/admin/privacy/requests?limit=100",
      );
      expect(list.status).toBe(200);
      const open = list.body.items.filter((item) =>
        ["received", "in_progress"].includes(item.status),
      );
      const firstClosed = list.body.items.findIndex(
        (item) => !["received", "in_progress"].includes(item.status),
      );
      if (firstClosed >= 0) expect(firstClosed).toBe(open.length);
      const dues = open.map((item) => Date.parse(item.dueAt));
      expect(dues).toEqual([...dues].sort((a, b) => a - b));
      const received = await http<{ items: RequestView[] }>(
        owner().baseUrl,
        "GET",
        "/admin/privacy/requests?status=received",
      );
      expect(received.body.items.every((item) => item.status === "received")).toBe(true);
      expect(
        (await http(owner().baseUrl, "GET", "/admin/privacy/requests?status=open")).status,
      ).toBe(400);
    });

    it("exports an email subject only with the matching email, completes the request and refuses a second export", async () => {
      const created = await http<RequestView>(owner().baseUrl, "POST", "/admin/privacy/requests", {
        body: { kind: "export", subject: { email: loneEmail } },
      });
      const path = `/admin/privacy/requests/${created.body.id}/export`;
      expect((await admin(path, {})).status).toBe(400);
      const wrong = await admin(path, { email: memberEmail });
      expect(wrong.status).toBe(400);
      expect(JSON.stringify(wrong.body)).toContain("subject_mismatch");
      const done = await http<ExportDoc>(owner().baseUrl, "POST", path, {
        body: { email: loneEmail },
      });
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      expect(done.headers.get("content-disposition")).toMatch(
        /^attachment; filename="personal-data-/,
      );
      expect(done.body.subject).toEqual({ kind: "email" });
      expect(done.body.account).toBeNull();
      expect(done.body.orders.map((order) => order.number)).toEqual([loneOrder.number]);
      expect(findForbiddenExportKeys(done.body)).toEqual([]);
      const after = await http<RequestView>(
        owner().baseUrl,
        "GET",
        `/admin/privacy/requests/${created.body.id}`,
      );
      expect(after.body).toMatchObject({
        status: "completed",
        result: { orders: 1, mail: 0, sessions: 0 },
      });
      expect(after.body.completedAt).not.toBeNull();
      const again = await admin(path, { email: loneEmail });
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({ code: "rule_violation", rule: "request_closed" });
      expect(await auditActions(created.body.id)).toEqual([
        "privacy.request_changed",
        "privacy.exported",
      ]);
    });

    it("exports a customer subject without an email and moves an erasure request to in_progress", async () => {
      const created = await http<RequestView>(owner().baseUrl, "POST", "/admin/privacy/requests", {
        body: { kind: "erasure", subject: { customerId: memberId } },
      });
      expect(created.status).toBe(201);
      const exported = await http<ExportDoc>(
        owner().baseUrl,
        "POST",
        `/admin/privacy/requests/${created.body.id}/export`,
        { body: {} },
      );
      expect(exported.status, JSON.stringify(exported.body)).toBe(200);
      expect(exported.body.subject).toEqual({ kind: "customer" });
      expect(exported.body.orders).toHaveLength(2);
      const after = await http<RequestView>(
        owner().baseUrl,
        "GET",
        `/admin/privacy/requests/${created.body.id}`,
      );
      expect(after.body).toMatchObject({ status: "in_progress", completedAt: null, result: null });
    });

    it("refuses with export_too_large above 10 000 orders, and changes nothing", async () => {
      const bulkEmail = `privacy-bulk-${runId}@example.test`;
      const prefix = randomBytes(2)
        .toString("hex")
        .toUpperCase()
        .replace(/[^0-9A-F]/g, "0");
      await world.pool.query(
        `insert into sales_order (number, status, email, phone, first_name, last_name, locale, currency,
           subtotal_amount, shipping_total, discount_total, tax_total, total_amount, idempotency_key,
           request_fingerprint, expires_at, cancelled_at)
         select $2 || '-' || upper(lpad(to_hex(i), 4, '0')), 'cancelled', $1, '+380501234567', 'B', 'K', 'uk', 'UAH',
           100, 0, 0, 0, 100, gen_random_uuid(), repeat('a', 64), now() + interval '1 day', now()
         from generate_series(1, 10001) as i`,
        [bulkEmail, prefix.slice(0, 1) + "Z" + prefix.slice(1, 3)],
      );
      try {
        const created = await http<RequestView>(
          owner().baseUrl,
          "POST",
          "/admin/privacy/requests",
          {
            body: { kind: "export", subject: { email: bulkEmail } },
          },
        );
        const refused = await admin(`/admin/privacy/requests/${created.body.id}/export`, {
          email: bulkEmail,
        });
        expect(refused.status).toBe(409);
        expect(refused.body).toMatchObject({ code: "rule_violation", rule: "export_too_large" });
        const after = await http<RequestView>(
          owner().baseUrl,
          "GET",
          `/admin/privacy/requests/${created.body.id}`,
        );
        expect(after.body.status).toBe("received");
      } finally {
        await world.pool.query("delete from sales_order where email = $1", [bulkEmail]);
      }
    }, 60_000);
  });
});
