import { describe, expect, it } from "vitest";
import {
  EXPORT_FORBIDDEN_KEYS,
  PERSONAL_DATA_EXPORT_FORMAT,
  buildPersonalDataExport,
  findForbiddenExportKeys,
  type PersonalDataExportFacts,
} from "./export.js";

const at = (iso: string) => new Date(iso);

function facts(): PersonalDataExportFacts {
  return {
    generatedAt: at("2026-11-01T10:00:00.000Z"),
    subject: { kind: "customer" },
    account: {
      email: "buyer@example.test",
      firstName: "Іван",
      lastName: "Петренко",
      phone: "+380501234567",
      isActive: true,
      emailVerifiedAt: at("2026-01-02T00:00:00.000Z"),
      lastLoginAt: at("2026-10-30T08:00:00.000Z"),
      passwordChangedAt: null,
      createdAt: at("2026-01-01T00:00:00.000Z"),
      updatedAt: at("2026-10-30T08:00:00.000Z"),
    },
    orders: [
      {
        number: "7K3M-9QX2",
        status: "fulfilled",
        locale: "uk",
        currency: "UAH",
        subtotalAmount: 200000,
        shippingTotal: 5000,
        discountTotal: 0,
        taxTotal: 0,
        totalAmount: 205000,
        placedAt: at("2026-02-01T10:00:00.000Z"),
        expiresAt: at("2026-02-01T10:30:00.000Z"),
        paidAt: at("2026-02-01T10:05:00.000Z"),
        fulfilledAt: at("2026-02-03T10:00:00.000Z"),
        cancelledAt: null,
        expiredAt: null,
        cancellationReason: null,
        paymentReference: "fake:INV-1",
        contact: {
          email: "buyer@example.test",
          phone: "+380501234567",
          firstName: "Іван",
          lastName: "Петренко",
        },
        shippingAddress: {
          countryCode: "UA",
          city: "Київ",
          line1: "вул. Хрещатик 1",
          postalCode: "01001",
          recipientFirstName: "Іван",
          recipientLastName: "Петренко",
          recipientPhone: "+380501234567",
        },
        billingAddress: null,
        lines: [
          {
            position: 1,
            sku: "TEE-RED-M",
            productTitle: "Футболка",
            variantTitle: "Червоний, M",
            optionValues: { color: "Червоний", size: "M" },
            unitAmount: 100000,
            compareAtAmount: null,
            quantity: 2,
            lineTotal: 200000,
            currency: "UAH",
            requiresShipping: true,
          },
        ],
        adjustments: [
          {
            kind: "shipping",
            code: "flat",
            label: "Доставка",
            amount: 5000,
            includedInPrice: false,
            source: "shipping",
          },
        ],
        shippingMethod: {
          methodCode: "pickup",
          kind: "pickup_point",
          providerCode: "nova-post",
          title: "Відділення",
          amount: 5000,
          currency: "UAH",
          destination: { name: "Відділення 1", city: "Київ" },
        },
        shipments: [
          {
            providerCode: "nova-post",
            status: "delivered",
            trackingNumber: "20450000000001",
            createdAt: at("2026-02-02T10:00:00.000Z"),
            deliveredAt: at("2026-02-03T10:00:00.000Z"),
          },
        ],
        payments: [
          {
            providerCode: "fake",
            status: "succeeded",
            amount: 205000,
            currency: "UAH",
            refundedAmount: 0,
            cardSystem: "visa",
            cardLast4: "4242",
            createdAt: at("2026-02-01T10:01:00.000Z"),
            refunds: [],
          },
        ],
        statusHistory: [
          {
            fromStatus: null,
            toStatus: "awaiting_payment",
            actorType: "customer",
            reason: null,
            createdAt: at("2026-02-01T10:00:00.000Z"),
          },
          {
            fromStatus: "awaiting_payment",
            toStatus: "paid",
            actorType: "system",
            reason: null,
            createdAt: at("2026-02-01T10:05:00.000Z"),
          },
        ],
      },
    ],
    mail: [
      {
        templateKey: "order.placed",
        locale: "uk",
        status: "sent",
        createdAt: at("2026-02-01T10:00:01.000Z"),
        sentAt: at("2026-02-01T10:00:05.000Z"),
      },
    ],
    sessions: [
      { createdAt: at("2026-10-30T08:00:00.000Z"), lastSeenAt: at("2026-10-30T09:00:00.000Z") },
    ],
    cart: {
      lines: [
        {
          sku: "TEE-RED-M",
          title: "Футболка",
          quantity: 1,
          seenUnitAmount: 100000,
          seenCurrency: "UAH",
        },
      ],
    },
    processors: [
      { kind: "email", name: "resend" },
      { kind: "payment", name: "monobank" },
    ],
  };
}

describe("buildPersonalDataExport (ADR 0033 decision 7)", () => {
  it("names its format and starts with the fixed top-level keys, in a fixed order", () => {
    expect(PERSONAL_DATA_EXPORT_FORMAT).toBe("fluxkit.personal-data-export/v1");
    const document = buildPersonalDataExport(facts());
    expect(Object.keys(document)).toEqual([
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
    expect(document.format).toBe("fluxkit.personal-data-export/v1");
    expect(document.generatedAt).toBe("2026-11-01T10:00:00.000Z");
    expect(document.subject).toEqual({ kind: "customer" });
  });

  it("writes times as ISO strings and keeps money as minor-unit integers with a currency", () => {
    const document = buildPersonalDataExport(facts());
    expect(document.account?.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(document.account?.passwordChangedAt).toBeNull();
    const order = document.orders[0];
    expect(order?.placedAt).toBe("2026-02-01T10:00:00.000Z");
    expect(order?.totalAmount).toBe(205000);
    expect(order?.currency).toBe("UAH");
    expect(order?.lines[0]).toMatchObject({
      sku: "TEE-RED-M",
      quantity: 2,
      unitAmount: 100000,
      lineTotal: 200000,
    });
  });

  it("contains the account, the order contact snapshot, addresses, shipments, payments and mail the person caused", () => {
    const document = buildPersonalDataExport(facts());
    expect(document.account).toMatchObject({
      email: "buyer@example.test",
      firstName: "Іван",
      phone: "+380501234567",
    });
    const order = document.orders[0];
    expect(order?.contact).toEqual({
      email: "buyer@example.test",
      phone: "+380501234567",
      firstName: "Іван",
      lastName: "Петренко",
    });
    expect(order?.shippingAddress).toMatchObject({
      city: "Київ",
      line1: "вул. Хрещатик 1",
      recipientPhone: "+380501234567",
    });
    expect(order?.shipments[0]).toMatchObject({
      trackingNumber: "20450000000001",
      status: "delivered",
    });
    expect(order?.payments[0]).toMatchObject({
      cardSystem: "visa",
      cardLast4: "4242",
      status: "succeeded",
    });
    expect(order?.statusHistory).toHaveLength(2);
    expect(document.mail).toEqual([
      {
        templateKey: "order.placed",
        locale: "uk",
        status: "sent",
        createdAt: "2026-02-01T10:00:01.000Z",
        sentAt: "2026-02-01T10:00:05.000Z",
      },
    ]);
    expect(document.sessions).toEqual([
      { createdAt: "2026-10-30T08:00:00.000Z", lastSeenAt: "2026-10-30T09:00:00.000Z" },
    ]);
    expect(document.cart?.lines).toEqual([
      {
        sku: "TEE-RED-M",
        title: "Футболка",
        quantity: 1,
        seenUnitAmount: 100000,
        seenCurrency: "UAH",
      },
    ]);
    expect(document.processors).toEqual([
      { kind: "email", name: "resend" },
      { kind: "payment", name: "monobank" },
    ]);
  });

  it("is stable: the same facts give byte-identical JSON", () => {
    expect(JSON.stringify(buildPersonalDataExport(facts()))).toBe(
      JSON.stringify(buildPersonalDataExport(facts())),
    );
  });

  it("exports an erased order with null contact fields and no address text", () => {
    const input = facts();
    const order = input.orders[0];
    if (order === undefined) throw new Error("fixture");
    const erased = {
      ...order,
      contact: { email: null, phone: null, firstName: null, lastName: null },
      shippingAddress: { countryCode: "UA" },
    };
    const exported = buildPersonalDataExport({ ...input, orders: [erased] }).orders[0];
    expect(exported?.contact).toEqual({
      email: null,
      phone: null,
      firstName: null,
      lastName: null,
    });
    expect(exported?.shippingAddress).toEqual({ countryCode: "UA" });
  });

  it("supports a guest subject found by email, with no account, cart or sessions", () => {
    const document = buildPersonalDataExport({
      ...facts(),
      subject: { kind: "email" },
      account: null,
      cart: null,
      sessions: [],
    });
    expect(document.subject).toEqual({ kind: "email" });
    expect(document.account).toBeNull();
    expect(document.cart).toBeNull();
    expect(document.sessions).toEqual([]);
  });

  it("copies only whitelisted keys: hashes, ids and keys smuggled into the facts never reach the document", () => {
    const polluted = JSON.parse(JSON.stringify(facts())) as Record<string, unknown>;
    const dirty = {
      passwordHash: "scrypt$x",
      tokenHash: "h",
      accessTokenHash: "h",
      requestFingerprint: "f",
      idempotencyKey: "k",
      providerRef: "r",
      providerPaymentId: "p",
      redirectUrl: "https://pay.example.test/x",
      actorAdminId: "a",
      createdBy: "a",
      customerId: "c",
      id: "i",
      orderId: "o",
    };
    const target = polluted as { account: object; orders: { [key: string]: unknown }[] };
    Object.assign(target.account, dirty);
    const firstOrder = target.orders[0];
    if (firstOrder === undefined) throw new Error("fixture");
    Object.assign(firstOrder, dirty);
    for (const key of ["lines", "payments", "shipments", "statusHistory", "adjustments"]) {
      const list = firstOrder[key] as object[];
      Object.assign(list[0] ?? {}, dirty);
    }
    Object.assign(firstOrder["contact"] as object, dirty);
    Object.assign(firstOrder["shippingAddress"] as object, dirty);
    const input = {
      ...polluted,
      generatedAt: at("2026-11-01T10:00:00.000Z"),
    } as unknown as PersonalDataExportFacts;
    // The dates became strings in the JSON round trip; restore them for the typed builder.
    const restored = restoreDates(input);
    const document = buildPersonalDataExport(restored);
    expect(findForbiddenExportKeys(document)).toEqual([]);
    expect(JSON.stringify(document)).not.toMatch(/scrypt|pay\.example\.test/);
  });
});

describe("findForbiddenExportKeys", () => {
  it("finds a forbidden key at any depth, in objects and arrays, and reports its path", () => {
    expect(findForbiddenExportKeys({ a: { passwordHash: "x" } })).toEqual(["a.passwordHash"]);
    expect(findForbiddenExportKeys({ list: [{ ok: 1 }, { tokenHash: "x" }] })).toEqual([
      "list[1].tokenHash",
    ]);
  });

  it("flags every name that smells like a secret or an internal id", () => {
    for (const key of [
      ...EXPORT_FORBIDDEN_KEYS,
      "someToken",
      "apiSecret",
      "userPassword",
      "orderId",
      "customerId",
      "productId",
      "id",
    ]) {
      expect(findForbiddenExportKeys({ [key]: 1 }), key).toEqual([key]);
    }
  });

  it("accepts the keys the document really uses", () => {
    expect(findForbiddenExportKeys(buildPersonalDataExport(facts()))).toEqual([]);
  });
});

/** Turns the ISO strings of the JSON round trip back into `Date`s where the typed facts expect them. */
function restoreDates<T>(value: T): T {
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  if (typeof value === "string" && iso.test(value)) return new Date(value) as unknown as T;
  if (Array.isArray(value)) return value.map((entry) => restoreDates(entry)) as unknown as T;
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, restoreDates(entry)]),
    ) as T;
  }
  return value;
}
