import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CreatePaymentInput, type PaymentWebhookInput } from "@fluxkit/core";
import { moneyOf as money } from "./payment-facts.service.js";
import { startApp } from "../test/app.js";
import { StorePaymentViews } from "./store/store-payment-views.js";
import { PaymentCreateService } from "./payment-create.service.js";
import { PaymentWorld } from "../test/payment-world.js";
import {
  createManagedPaymentFixture,
  testSecretsKeyRing,
  type ManagedPaymentFixture,
} from "../test/integration-provider-fixture.js";
import {
  TEST_PAYMENT_SIGNATURE_HEADER,
  type TestPaymentWebhookBody,
} from "../test/test-payment-provider.js";
import { ensureMigrated } from "../test/migrate.js";
import { DISABLED_INTEGRATIONS_CONFIG } from "../integrations/integrations.config.js";
import { IntegrationsRepository } from "../integrations/integrations.repository.js";
import { InstalledIntegrations } from "../integrations/installed-integrations.js";
import { PaymentProviderRegistry } from "./registry/index.js";
import { withTransaction } from "../common/transaction.js";
import { SecretCipher } from "../integrations/secret-cipher.js";
import { PaymentProviders } from "./registry/payment-providers.js";
import { PaymentsRepository } from "./attempts/payments.repository.js";
import { PaymentReadsService } from "./payment-reads.service.js";
import { PaymentHandoffService } from "./payment-handoff.service.js";
import { OrdersRepository } from "../orders/orders.repository.js";
import type pg from "pg";
import { PG_POOL } from "../database/database.module.js";
import { PersonalDataExportService } from "../privacy/export/personal-data-export.service.js";
import { PersonalDataReader } from "../privacy/export/personal-data.reader.js";
import { createTestCustomer, deleteTestCustomers } from "../test/customer-fixtures.js";
import { customerLoginCookie } from "../test/customer-http.js";
import { http } from "../test/http.js";
import { Shopper } from "../test/shopper.js";
import { CUSTOMER_SESSION_COOKIE_NAME } from "../customers/auth/customer-session-cookie.js";

const TOKEN_A = "test_managed_A_0123456789";
const TOKEN_B = "test_managed_B_0123456789";
type Invoice = TestPaymentWebhookBody;
describe("managed payment bindings (real Postgres, fixture provider transport)", () => {
  let world: PaymentWorld;
  let fixture: ManagedPaymentFixture;
  let integrationId: string;
  let a: string;
  let b: string;
  const ring = testSecretsKeyRing();
  const cipher = new SecretCipher(ring);
  let calls: ManagedPaymentFixture["payment"]["calls"];
  let bindingObserved: string | null = null;
  beforeAll(async () => {
    await ensureMigrated([], { reset: true });
    fixture = await createManagedPaymentFixture();
    calls = fixture.payment.calls;
    world = await PaymentWorld.start({
      paymentDelegated: true,
      secretsKeyRing: ring,
      integrationProvidersDir: fixture.dir,
      paymentCallTimeoutMs: 3_000,
    });
    integrationId = randomUUID();
    await world.pool.query(
      "insert into integration(id,kind,provider_code) values($1,'payment','testpay')",
      [integrationId],
    );
    a = await addVersion(integrationId, "testpay", { token: TOKEN_A });
    await activate(integrationId, a);
    fixture.payment.onRequest = async (request, input) => {
      if (request.operation !== "create") return;
      const payment = input as CreatePaymentInput;
      const binding = await world.pool.query<{ integration_credential_version_id: string }>(
        "select integration_credential_version_id from payment where id=$1",
        [payment.paymentId],
      );
      bindingObserved = binding.rows[0]?.integration_credential_version_id ?? null;
    };
  });
  afterAll(async () => {
    if (world !== undefined) await world.stop();
    if (fixture !== undefined) await fixture.remove();
    await ensureMigrated([], { reset: true });
  });
  async function addVersion(owner: string, code: string, values: Readonly<Record<string, string>>) {
    const id = randomUUID();
    const next = await world.pool.query<{ n: number }>(
      "select coalesce(max(generation),0)::int+1 n from integration_credential_version where integration_id=$1",
      [owner],
    );
    const generation = next.rows[0]?.n ?? 1;
    await world.pool.query(
      "insert into integration_credential_version(id,integration_id,generation,purpose,state) values($1,$2,$3,'outbound','candidate')",
      [id, owner, generation],
    );
    for (const [field, value] of Object.entries(values)) {
      const secretId = randomUUID();
      const sealed = cipher.seal(
        { secretId, integrationId: owner, kind: "payment", providerCode: code, field, generation },
        value,
      );
      await world.pool.query(
        "insert into integration_secret(id,version_id,field,key_id,nonce,ciphertext,tag) values($1,$2,$3,$4,$5,$6,$7)",
        [secretId, id, field, sealed.keyId, sealed.nonce, sealed.ciphertext, sealed.tag],
      );
    }
    return id;
  }
  async function activate(owner: string, id: string) {
    await world.pool.query(
      "update integration_credential_version set state='draining' where integration_id=$1 and state='active'",
      [owner],
    );
    await world.pool.query("update integration_credential_version set state='active' where id=$1", [
      id,
    ]);
    await world.pool.query(
      "update integration set enabled=true,active_outbound_version_id=$2 where id=$1",
      [owner, id],
    );
    await world.pool.query("update integration_revision set revision=revision+1");
  }
  async function row(id: string) {
    const found = await world.app.app.get(PaymentsRepository).findById(world.orders.db, id);
    if (found === undefined) throw new Error("missing_test_payment");
    return found;
  }
  function webhook(invoice: Invoice, token: string): PaymentWebhookInput {
    const rawBody = Buffer.from(JSON.stringify(invoice));
    return {
      rawBody,
      headers: {
        "content-type": "application/json",
        [TEST_PAYMENT_SIGNATURE_HEADER]: createHmac("sha256", token).update(rawBody).digest("hex"),
      },
    };
  }
  async function created() {
    const placed = await world.place();
    const result = await world.createService.createPaymentForOrder({
      orderId: placed.id,
      idempotencyKey: randomUUID(),
      createdBy: "guest",
      providerCode: "testpay",
    });
    expect(result.kind).toBe("created");
    if (result.kind !== "created") throw new Error("not_created");
    const payment = await row(result.payment.paymentId);
    const invoice = fixture.payment.invoice(payment.providerPaymentId ?? "");
    return { placed, payment, invoice };
  }
  it.each(["checkout", "admin refund", "automatic refund", "privacy export"])(
    "completes %s with a one-connection payment pool",
    async (operation) => {
      const work = operation === "checkout" ? undefined : await created();
      if (work !== undefined && operation === "admin refund") {
        fixture.payment.backend.setStatus(work.invoice.invoiceId, "succeeded");
        expect(
          (
            await world.webhook(webhook(fixture.payment.invoice(work.invoice.invoiceId), TOKEN_A), {
              provider: "testpay",
            })
          ).status,
        ).toBe(200);
      }
      if (work !== undefined && operation === "automatic refund") {
        await world.orderService.cancelAsAdmin(
          work.placed.id,
          world.orders.ownerId,
          "test cancellation",
        );
      }
      const pool = world.app.app.get<pg.Pool>(PG_POOL);
      const max = pool.options.max;
      // pg keeps surplus idle clients after lowering max; reserve them so only one connection is usable.
      const reserved = await Promise.all(
        Array.from({ length: Math.max(1, pool.totalCount) }, () => pool.connect()),
      );
      pool.options.max = 1;
      reserved.pop()?.release();
      try {
        if (work === undefined) {
          expect((await world.place()).payment?.canPay).toBe(true);
        } else if (operation === "admin refund") {
          const refund = await world.refunds.requestAdminRefund({
            orderId: work.placed.id,
            paymentId: work.payment.id,
            adminId: world.orders.ownerId,
            amount: money(work.payment.amount, "UAH"),
            note: "test",
            idempotencyKey: randomUUID(),
            now: new Date(),
          });
          expect(refund.kind).toBe("requested");
          if (refund.kind === "requested")
            expect(await world.refunds.sendRefund(refund.refund.id, new Date())).toMatchObject({
              kind: "answered",
              status: "succeeded",
            });
        } else if (operation === "automatic refund") {
          expect(
            (
              await world.webhook(webhook({ ...work.invoice, status: "success" }, TOKEN_A), {
                provider: "testpay",
              })
            ).status,
          ).toBe(200);
          expect(await world.refundsOf(work.payment.id)).toMatchObject([
            { reason: "late_payment", status: "requested" },
          ]);
        } else {
          const exported = await withTransaction(world.orders.db, async (tx) => {
            const subject = await world.app.app
              .get(PersonalDataReader)
              .byEmail(tx, work.placed.email);
            return world.app.app.get(PersonalDataExportService).build(tx, subject, new Date());
          });
          expect(exported.document.processors).toContainEqual({
            kind: "payment",
            name: "testpay",
          });
        }
      } finally {
        pool.options.max = max;
        for (const client of reserved) client.release();
      }
    },
  );
  it.each([
    ["guest", "env shadow"],
    ["customer", "env shadow"],
    ["guest", "no active version"],
    ["customer", "no active version"],
    ["guest", "snapshot error"],
    ["customer", "snapshot error"],
  ])("renders persisted %s payment status when new admissions have %s", async (route, failure) => {
    const restarted = await startApp({
      paymentDelegated: true,
      secretsKeyRing: ring,
      integrationProvidersDir: fixture.dir,
      integrationEnvironment: failure === "env shadow" ? { TESTPAY_TOKEN: TOKEN_B } : {},
    });
    const account = await createTestCustomer(world.orders.db, {
      password: "test password for status",
    });
    try {
      const shopper = new Shopper(world.app.baseUrl);
      const cookie = await customerLoginCookie(
        restarted.baseUrl,
        account.email,
        "test password for status",
      );
      if (route === "customer")
        shopper.setCookie(CUSTOMER_SESSION_COOKIE_NAME, cookie.slice(cookie.indexOf("=") + 1));
      for (const status of ["success", "failure"]) {
        const placed = await world.orders.place([{ quantity: 1 }], {}, shopper);
        const result = await world.createService.createPaymentForOrder({
          orderId: placed.id,
          idempotencyKey: randomUUID(),
          createdBy: route === "guest" ? "guest" : "customer",
          providerCode: "testpay",
        });
        if (result.kind !== "created") throw new Error("not_created");
        const payment = await row(result.payment.paymentId);
        const invoice = fixture.payment.invoice(payment.providerPaymentId ?? "");
        expect(
          (await world.webhook(webhook({ ...invoice, status }, TOKEN_A), { provider: "testpay" }))
            .status,
        ).toBe(200);
        const revision = await world.pool.query<{ revision: string }>(
          "select revision from integration_revision where id=1",
        );
        try {
          if (failure === "no active version") {
            await world.pool.query(
              "update integration_credential_version set state='draining' where id=$1",
              [a],
            );
            await world.pool.query("update integration_revision set revision=revision+1");
          }
          if (failure === "snapshot error")
            await world.pool.query("delete from integration_revision where id=1");
          const response =
            route === "guest"
              ? await http(restarted.baseUrl, "POST", "/store/orders/payments/status", {
                  body: {
                    number: placed.number,
                    accessToken: placed.accessToken,
                    paymentId: payment.id,
                  },
                })
              : await http(
                  restarted.baseUrl,
                  "GET",
                  `/store/account/orders/${placed.number}/payments/${payment.id}`,
                  { headers: { cookie } },
                );
          expect(response.status, JSON.stringify(response.body)).toBe(200);
          expect(response.body).toMatchObject({
            paymentId: payment.id,
            status: status === "success" ? "paid" : "failed",
            canRetry: false,
            unavailableReason: "payment_not_available",
          });
          const order = await world.app.app
            .get(OrdersRepository)
            .findById(world.orders.db, placed.id);
          if (order === undefined) throw new Error("missing_order");
          expect(
            await restarted.app.get(StorePaymentViews).orderPayment(world.orders.db, order),
          ).toMatchObject({
            canPay: false,
            providers: [],
            unavailableReason: "payment_not_available",
            latest: { paymentId: payment.id },
          });
          await expect(restarted.app.get(PaymentProviders).active()).rejects.toBeDefined();
          if (failure !== "snapshot error")
            await expect(
              withTransaction(world.orders.db, (tx) =>
                restarted.app.get(PaymentProviders).admit(tx, "testpay"),
              ),
            ).rejects.toBeDefined();
          if (status === "failure") {
            const create =
              route === "guest"
                ? await http(restarted.baseUrl, "POST", "/store/orders/payments", {
                    body: {
                      number: placed.number,
                      accessToken: placed.accessToken,
                      provider: "testpay",
                    },
                    headers: { "idempotency-key": randomUUID() },
                  })
                : await http(
                    restarted.baseUrl,
                    "POST",
                    `/store/account/orders/${placed.number}/payments`,
                    {
                      body: { provider: "testpay" },
                      headers: { cookie, "idempotency-key": randomUUID() },
                    },
                  );
            expect(create.status).toBe(503);
          }
        } finally {
          if (failure === "snapshot error")
            await world.pool.query("insert into integration_revision(id,revision) values(1,$1)", [
              revision.rows[0]?.revision,
            ]);
          await activate(integrationId, a);
        }
      }
    } finally {
      await restarted.app.close();
      await world.pool.query("update sales_order set customer_id=null where customer_id=$1", [
        account.id,
      ]);
      await deleteTestCustomers(world.orders.db, [account.id]);
    }
  });
  it("answers 404 for a known legacy webhook with blank env enablement and 503 for unavailable managed bindings", async () => {
    const placed = await world.place();
    const legacyId = randomUUID();
    const invoiceId = `legacy_${randomUUID()}`;
    await world.pool.query(
      "insert into payment(id,order_id,provider_code,provider_payment_id,amount,currency,status,expires_at,created_by,idempotency_key) values($1,$2,'testpay',$3,$4,'UAH','failed',now()+interval '30 minutes','guest',$5)",
      [legacyId, placed.id, invoiceId, placed.total, randomUUID()],
    );
    const disabled = await startApp({
      paymentDelegated: false,
      extraPaymentProviders: [],
      secretsKeyRing: ring,
      integrationProvidersDir: fixture.dir,
      integrationEnvironment: { PAYMENT_PROVIDERS_ENABLED: "" },
    });
    try {
      const now = new Date().toISOString();
      const invoice: Invoice = {
        invoiceId,
        reference: legacyId,
        amount: placed.total,
        ccy: "UAH",
        status: "created",
        modifiedDate: now,
        finalAmount: placed.total,
        errCode: null,
        cancelList: [],
        paymentInfo: null,
      };
      const before = calls.length;
      expect(
        (
          await world.webhook(webhook(invoice, TOKEN_A), {
            provider: "testpay",
            running: disabled,
          })
        ).status,
      ).toBe(404);
      expect(await world.eventsOf(legacyId)).toEqual([]);
      const retained = await created();
      await world.pool.query(
        "update integration_credential_version set state='revoked',revoked_at=now() where id=$1",
        [a],
      );
      expect(
        (
          await world.webhook(webhook(retained.invoice, TOKEN_A), {
            provider: "testpay",
            running: disabled,
          })
        ).status,
      ).toBe(503);
      expect(calls.slice(before).filter((call) => call.operation === "verify")).toEqual([]);
    } finally {
      // The next tests use a fresh active version; revoked A stays a terminal tombstone.
      a = await addVersion(integrationId, "testpay", { token: TOKEN_A });
      await activate(integrationId, a);
      await disabled.app.close();
    }
  });
  it("stores the active binding before the first HTTP call and keeps it on idempotent replay after rotation", async () => {
    const placed = await world.place();
    const key = randomUUID();
    const result = await world.createService.createPaymentForOrder({
      orderId: placed.id,
      idempotencyKey: key,
      createdBy: "guest",
      providerCode: "testpay",
    });
    expect(result.kind).toBe("created");
    if (result.kind !== "created") throw new Error("not_created");
    expect(bindingObserved).toBe(a);
    b = await addVersion(integrationId, "testpay", { token: TOKEN_B });
    await activate(integrationId, b);
    const count = calls.length;
    expect(
      await world.createService.createPaymentForOrder({
        orderId: placed.id,
        idempotencyKey: key,
        createdBy: "guest",
        providerCode: "testpay",
      }),
    ).toMatchObject({
      kind: "created",
      replay: true,
      payment: { paymentId: result.payment.paymentId },
    });
    expect((await row(result.payment.paymentId)).integrationCredentialVersionId).toBe(a);
    expect(calls).toHaveLength(count);
  });
  it("reads, reconciles, refunds and invalidates with A after B activation, including while disabled", async () => {
    await activate(integrationId, a);
    const work = await created();
    await activate(integrationId, b);
    const start = calls.length;
    expect(await world.app.app.get(PaymentReadsService).readNow(work.payment)).toEqual({
      kind: "read",
    });
    await world.pool.query("update integration set enabled=false where id=$1", [integrationId]);
    await world.pool.query(
      "update integration_credential_version set state='draining' where id=$1",
      [b],
    );
    await world.pool.query("update integration_revision set revision=revision+1");
    expect(await world.app.app.get(PaymentProviders).onlineEnabled()).toBe(false);
    expect(
      await world.createService.createPaymentForOrder({
        orderId: (await world.place()).id,
        idempotencyKey: randomUUID(),
        createdBy: "guest",
        providerCode: "testpay",
      }),
    ).toMatchObject({ kind: "refused", rule: "payment_not_available" });
    fixture.payment.backend.setStatus(work.invoice.invoiceId, "succeeded");
    const paid = fixture.payment.invoice(work.invoice.invoiceId);
    expect((await world.webhook(webhook(paid, TOKEN_A), { provider: "testpay" })).status).toBe(200);
    const refund = await world.refunds.requestAdminRefund({
      orderId: work.placed.id,
      paymentId: work.payment.id,
      adminId: world.orders.ownerId,
      amount: money(work.payment.amount, "UAH"),
      note: "test",
      idempotencyKey: randomUUID(),
      now: new Date(),
    });
    expect(refund.kind).toBe("requested");
    if (refund.kind === "requested") await world.refunds.sendRefund(refund.refund.id, new Date());
    // Job 11 must scan retained work even with no currently active payment provider.
    await world.pool.query("update payment set next_check_at=now() where id=$1", [work.payment.id]);
    expect((await world.job11(new Date(Date.now() + 2000))).scanned).toBeGreaterThan(0);
    expect(calls.slice(start).map((call) => call.operation)).toEqual(
      expect.arrayContaining(["status", "verify", "refund"]),
    );
    expect(calls.slice(start).every((call) => call.token === TOKEN_A)).toBe(true);
    await activate(integrationId, a);
    const unpaid = await created();
    await activate(integrationId, b);
    await world.orderService.cancelAsAdmin(
      unpaid.placed.id,
      world.orders.ownerId,
      "test cancellation",
    );
    await world.job11(new Date(Date.now() + 1000));
    expect(calls.some((call) => call.operation === "remove" && call.token === TOKEN_A)).toBe(true);
  });
  it("verifies A-bound webhooks with A only and unknown webhooks with the active key only", async () => {
    await activate(integrationId, a);
    const work = await created();
    await activate(integrationId, b);
    expect(
      (await world.webhook(webhook(work.invoice, TOKEN_B), { provider: "testpay" })).status,
    ).toBe(401);
    expect(
      (await world.webhook(webhook(work.invoice, TOKEN_A), { provider: "testpay" })).status,
    ).toBe(200);
    const unknown = {
      ...work.invoice,
      invoiceId: `unknown_${randomUUID()}`,
      reference: randomUUID(),
    };
    const start = calls.length;
    expect((await world.webhook(webhook(unknown, TOKEN_A), { provider: "testpay" })).status).toBe(
      401,
    );
    expect(calls.length).toBeGreaterThan(start);
    expect(calls.slice(start).every((call) => call.token === TOKEN_B)).toBe(true);
    expect((await world.webhook(webhook(unknown, TOKEN_B), { provider: "testpay" })).status).toBe(
      200,
    );
  });
  it("committing revoke after verification but before fact commit leaves no fact or order effect", async () => {
    await activate(integrationId, a);
    const work = await created();
    await activate(integrationId, b);
    // Prime A's verifier before taking the order barrier.
    expect(
      (await world.webhook(webhook(work.invoice, TOKEN_A), { provider: "testpay" })).status,
    ).toBe(200);
    const before = await world.eventsOf(work.payment.id);
    const blocker = await world.pool.connect();
    await blocker.query("begin");
    await blocker.query("select id from sales_order where id=$1 for update", [work.placed.id]);
    const pending = world.webhook(
      webhook(
        {
          ...work.invoice,
          status: "success",
          modifiedDate: new Date(Date.now() + 2000).toISOString(),
        },
        TOKEN_A,
      ),
      { provider: "testpay" },
    );
    try {
      await world.waitForLockWaiters(1);
      await world.pool.query(
        "update integration_credential_version set state='revoked',revoked_at=now() where id=$1",
        [a],
      );
    } finally {
      await blocker.query("commit");
      blocker.release();
    }
    expect((await pending).status).toBe(503);
    expect(await world.eventsOf(work.payment.id)).toHaveLength(before.length);
    expect((await world.orderStatus(work.placed.id)).status).toBe("awaiting_payment");
  });
  it("refuses new managed work shadowed by a new env key but retains the original bound client", async () => {
    const config = {
      ...DISABLED_INTEGRATIONS_CONFIG,
      keyRing: ring,
      paymentDelegated: true,
      shopCurrency: "UAH",
      storefrontPublicUrl: "https://shop.example.com",
      providersDir: fixture.dir,
      environment: { TESTPAY_TOKEN: "env_override_test_0123456789" },
    };
    const source = new PaymentProviders(
      world.orders.db,
      world.app.app.get(PaymentProviderRegistry),
      config,
      new IntegrationsRepository(world.orders.db),
      new InstalledIntegrations(config),
      cipher,
    );
    await expect(source.active()).rejects.toBeDefined();
    await expect(
      withTransaction(world.orders.db, (tx) => source.admit(tx, "testpay")),
    ).rejects.toBeDefined();
    expect(
      await source.forPayment({ providerCode: "testpay", integrationCredentialVersionId: b }),
    ).toBeDefined();
  });
  it("retains UAH-bound work after the shop currency changes on restart", async () => {
    const config = {
      ...DISABLED_INTEGRATIONS_CONFIG,
      keyRing: ring,
      paymentDelegated: true,
      shopCurrency: "USD",
      storefrontPublicUrl: "https://shop.example.com",
      providersDir: fixture.dir,
    };
    const source = new PaymentProviders(
      world.orders.db,
      world.app.app.get(PaymentProviderRegistry),
      config,
      new IntegrationsRepository(world.orders.db),
      new InstalledIntegrations(config),
      cipher,
    );
    const retained = await source.forPayment({
      providerCode: "testpay",
      integrationCredentialVersionId: b ?? a,
    });
    expect(retained?.code).toBe("testpay");
    expect(retained?.capabilities.currencies).toContain("UAH");
    expect(await source.active()).toEqual([]);
  });
  it("replays an existing key without consulting an unavailable active source and keeps retained status visible after currency change", async () => {
    const placed = await world.place();
    const key = randomUUID();
    const input = {
      orderId: placed.id,
      idempotencyKey: key,
      createdBy: "guest" as const,
      providerCode: "testpay",
    };
    const created = await world.createService.createPaymentForOrder(input);
    expect(created.kind).toBe("created");
    if (created.kind !== "created") throw new Error("not_created");
    const common = {
      paymentDelegated: true,
      secretsKeyRing: ring,
      integrationProvidersDir: fixture.dir,
    };
    const restarted = await startApp({
      ...common,
      integrationEnvironment: { TESTPAY_TOKEN: "env_override_test_0123456789" },
    });
    const otherCurrency = await startApp({ ...common, shopCurrency: "USD" });
    try {
      const before = calls.length;
      expect(
        await restarted.app.get(PaymentCreateService).createPaymentForOrder(input),
      ).toMatchObject({
        kind: "created",
        replay: true,
        payment: { paymentId: created.payment.paymentId },
      });
      expect(calls).toHaveLength(before);
      const order = await world.app.app.get(OrdersRepository).findById(world.orders.db, placed.id);
      if (order === undefined) throw new Error("no_order");
      const view = await otherCurrency.app
        .get(StorePaymentViews)
        .statusView(world.orders.db, order, await row(created.payment.paymentId));
      expect(view).toMatchObject({
        paymentId: created.payment.paymentId,
        status: "waiting",
        canRetry: false,
      });
      expect(await otherCurrency.app.get(PaymentProviders).active()).toEqual([]);
    } finally {
      await restarted.app.close();
      await otherCurrency.app.close();
    }
  });
  it("a cached bound client refuses every later transport after revoke with zero simulated requests", async () => {
    const source = world.app.app.get(PaymentProviders);
    const port = await source.forPayment({
      providerCode: "testpay",
      integrationCredentialVersionId: b ?? a,
    });
    expect(port).toBeDefined();
    await world.pool.query(
      "update integration_credential_version set state='revoked',revoked_at=now() where id=$1",
      [b],
    );
    const before = calls.length;
    const signal = new AbortController().signal;
    await expect(port?.getPayment("invoice_test", signal)).rejects.toMatchObject({
      code: "credential_revoked",
    });
    await expect(port?.invalidatePayment("invoice_test", signal)).rejects.toMatchObject({
      code: "credential_revoked",
    });
    await expect(
      port?.refund(
        {
          providerPaymentId: "invoice_test",
          refundId: randomUUID(),
          amount: money(100, "UAH"),
          full: true,
        },
        signal,
      ),
    ).rejects.toMatchObject({ code: "credential_revoked" });
    expect(calls).toHaveLength(before);
    await world.pool.query(
      "update integration set enabled=false,active_outbound_version_id=null where id=$1",
      [integrationId],
    );
    await world.pool.query("update integration_revision set revision=revision+1");
  });
  it("LiqPay-style fixture handoff keeps its bound pair after rotation and refuses signing after revoke", async () => {
    const owner = randomUUID();
    await world.pool.query(
      "insert into integration(id,kind,provider_code) values($1,'payment','pairpay')",
      [owner],
    );
    const first = await addVersion(owner, "pairpay", {
      public_key: "sandbox_testpublicA",
      private_key: "test_private_key_A_0123456789",
    });
    await activate(owner, first);
    const placed = await world.place();
    const result = await world.createService.createPaymentForOrder({
      orderId: placed.id,
      idempotencyKey: randomUUID(),
      createdBy: "guest",
      providerCode: "pairpay",
    });
    expect(result.kind).toBe("created");
    if (result.kind !== "created") throw new Error("not_created");
    const second = await addVersion(owner, "pairpay", {
      public_key: "sandbox_testpublicB",
      private_key: "test_private_key_B_0123456789",
    });
    await activate(owner, second);
    const order = await world.app.app.get(OrdersRepository).findById(world.orders.db, placed.id);
    if (order === undefined) throw new Error("missing_order");
    const service = world.app.app.get(PaymentHandoffService);
    const handoff = await service.handoffForAttempt(order, result.payment.paymentId);
    expect(
      JSON.parse(Buffer.from(handoff.fields.data ?? "", "base64").toString("utf8")),
    ).toMatchObject({ public_key: "sandbox_testpublicA" });
    expect(handoff.fields.signature).toBe(
      createHmac("sha256", "test_private_key_A_0123456789")
        .update(handoff.fields.data ?? "")
        .digest("hex"),
    );
    const cached = await world.app.app.get(PaymentProviders).forPayment({
      providerCode: "pairpay",
      integrationCredentialVersionId: first,
    });
    if (cached === undefined) throw new Error("missing_bound_pair");
    const input = fixture.pair.backend.creates[0];
    if (input === undefined) throw new Error("missing_pair_create");
    const signed = fixture.pair.calls.length;
    await world.pool.query(
      "update integration_credential_version set state='revoked',revoked_at=now() where id=$1",
      [first],
    );
    await expect(service.handoffForAttempt(order, result.payment.paymentId)).rejects.toBeDefined();
    await expect(
      cached.buildCheckoutHandoff(input, new AbortController().signal),
    ).rejects.toMatchObject({ code: "credential_revoked" });
    expect(fixture.pair.calls).toHaveLength(signed);
  });
});
