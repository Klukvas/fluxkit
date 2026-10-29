import type { AdminConfig, AdminOrder, AdminShipment } from "@fluxkit/api-client";
import { ROLE_PERMISSIONS } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import { formatDateTime } from "../../lib/format";
import { leftoverText, renderInRouter, sentinelTranslator } from "../../test-helpers";
import { StatusLine } from "./order-parts";
import { SHIPMENT_FIELDS, planShipment, shipmentFormDefaults } from "./shipment-form";
import type { ShipmentNotice } from "./shipment-outcome";
import {
  CreateWaybillForm,
  ShipmentNoticeView,
  ShipmentPanel,
  ShippingSnapshot,
} from "./shipment-panel";
import { createGate, offeredShipmentActions } from "./shipment-view";

const sentinel = sentinelTranslator();
const noop = () => undefined;
const NOW = new Date("2026-10-25T12:00:00.000Z");
const MANAGER = [...ROLE_PERMISSIONS.manager];
const ME = "11111111-1111-4111-8111-111111111111";

const config: AdminConfig = {
  defaultLocale: "uk",
  locales: ["uk", "en"],
  shopCurrency: "UAH",
  currencyExponent: 2,
  supportedCurrencies: [{ code: "UAH", exponent: 2 }],
  pricesIncludeTax: true,
  lowStockThreshold: 5,
  emailDelivery: false,
  onlinePayment: false,
  search: false,
  media: { uploadsEnabled: true, maxBytes: 1, contentTypes: [] },
};
const money = { locale: "en", config };

function shipment(overrides: Partial<AdminShipment> = {}): AdminShipment {
  return {
    id: "ship-1",
    status: "created",
    providerCode: "fake",
    providerService: null,
    trackingNumber: "FAKE000001",
    carrierStatusCode: "FAKE_CREATED",
    carrierStatusAt: "2026-10-25T11:01:00.000Z",
    clientReference: "7K3M-9QX2",
    declaredValue: { amount: 18900, currency: "UAH" },
    carrierCost: { amount: 7500, currency: "UAH" },
    payer: "sender",
    weightGrams: 1500,
    lengthMm: 300,
    widthMm: 200,
    heightMm: 100,
    seats: 1,
    createdBy: ME,
    createdAt: "2026-10-25T11:00:00.000Z",
    updatedAt: "2026-10-25T11:01:00.000Z",
    cancelledAt: null,
    deliveredAt: null,
    nextTrackAt: null,
    history: [
      {
        fromStatus: null,
        toStatus: "pending",
        carrierStatusCode: null,
        actorType: "admin",
        actorAdminId: ME,
        at: "2026-10-25T11:00:00.000Z",
      },
      {
        fromStatus: "pending",
        toStatus: "created",
        carrierStatusCode: "FAKE_CREATED",
        actorType: "admin",
        actorAdminId: ME,
        at: "2026-10-25T11:00:01.000Z",
      },
    ],
    ...overrides,
  };
}

function order(overrides: Partial<AdminOrder> = {}): AdminOrder {
  return {
    id: "0b5f8a52-7a9e-4c7a-9d0e-1a2b3c4d5e6f",
    number: "7K3M-9QX2",
    status: "paid",
    locale: "uk",
    currency: "UAH",
    subtotal: { amount: 18900, currency: "UAH" },
    shipping: {
      methodId: null,
      methodCode: "courier",
      kind: "pickup_point",
      providerCode: "fake",
      providerService: "express",
      amount: { amount: 8000, currency: "UAH" },
      payer: "shop_charge",
      estimatedCarrierAmount: { amount: 7500, currency: "UAH" },
      destination: {
        providerRef: "fake-city-kyiv-point-1",
        number: "1",
        kind: "branch",
        cityRef: "fake-city-kyiv",
        cityName: "<i>Kyiv</i>",
        description: "Branch <b>1</b>",
      },
      title: { uk: "Кур'єр <b>Z</b>", en: "Courier" },
    },
    shipments: [],
    ...overrides,
  } as AdminOrder;
}

function panel(
  value: AdminOrder,
  permissions: readonly string[] | null,
  t = sentinel,
  extra: { busy?: boolean } = {},
): string {
  const gate = createGate(value, permissions);
  const exponent = 2;
  const defaults = shipmentFormDefaults(value, exponent);
  return renderInRouter(
    <ShipmentPanel
      t={t}
      uiLocale="en"
      order={value}
      money={money}
      shipments={value.shipments}
      actionsFor={(entry) => offeredShipmentActions(entry, permissions, NOW)}
      onAction={noop}
      busy={extra.busy ?? false}
      meId={ME}
      emails={null}
      now={NOW}
      statusLine={<StatusLine />}
      createForm={
        <CreateWaybillForm
          t={t}
          gate={gate}
          carrier="fake"
          currency="UAH"
          exponent={exponent}
          values={defaults}
          onChange={noop}
          issues={{}}
          summary={[]}
          busy={extra.busy ?? false}
          onSubmit={noop}
        />
      }
    />,
    `/orders/${value.id}`,
  );
}

function withoutData(html: string, data: readonly string[]): string {
  const escape = (text: string) =>
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#x27;");
  return data.reduce((rest, text) => rest.split(escape(text)).join(" "), html);
}

const DATA = [
  "FAKE000001",
  "FAKE_CREATED",
  "fake / express",
  "fake",
  "UAH 80.00",
  "UAH 75.00",
  "UAH 189.00",
  "<i>Kyiv</i>",
  "<b>1</b>",
  "Branch <b>1</b>",
  "Courier",
  "7K3M-9QX2",
  "1500 g",
  "2026-10-25T11:00:00.000Z",
  formatDateTime("2026-10-25T11:00:00.000Z", "en"),
  formatDateTime("2026-10-25T11:00:01.000Z", "en"),
  formatDateTime("2026-10-25T11:01:00.000Z", "en"),
];

/** The opening tag of the element with this `name`. */
function tag(html: string, element: string, name: string): string {
  const found = [...html.matchAll(new RegExp(`<${element}[^>]*>`, "g"))]
    .map((match) => match[0])
    .find((text) => text.includes(`name="${name}"`));
  if (found === undefined) throw new Error(`No <${element} name="${name}">`);
  return found;
}

describe("the shipping snapshot", () => {
  it("shows the method, price, who pays, the estimate and the pickup point, as text", () => {
    const html = renderInRouter(
      <ShippingSnapshot t={sentinel} uiLocale="en" order={order()} money={money} />,
    ).replace(/\u00a0/g, " ");
    expect(html).toContain("§shipment.kind.pickup_point");
    expect(html).toContain("UAH 80.00");
    expect(html).toContain("§shipment.snapshot.payer.shop_charge");
    expect(html).toContain("UAH 75.00");
    expect(html).toContain("§shipment.snapshot.destinationValue");
    expect(html).not.toContain("<b>Z</b>");
    expect(html).not.toContain("<i>Kyiv</i>");
  });

  it("says so for an order placed without a delivery method", () => {
    const html = renderInRouter(
      <ShippingSnapshot
        t={sentinel}
        uiLocale="en"
        order={order({ shipping: null })}
        money={money}
      />,
    );
    expect(html).toContain("§shipment.snapshot.none");
  });
});

describe("the shipments panel", () => {
  it("renders every part without hardcoded text", () => {
    const pending = shipment({
      id: "p",
      status: "pending",
      trackingNumber: null,
      createdAt: "2026-10-25T11:00:00.000Z",
    });
    for (const value of [
      order(),
      order({ shipments: [shipment()] }),
      order({ shipments: [shipment({ status: "unknown", trackingNumber: null })] }),
      order({ shipments: [pending] }),
      order({ shipments: [shipment({ status: "failed" })] }),
      order({ status: "awaiting_payment" }),
      order({ status: "fulfilled" }),
      order({ shipping: null }),
    ]) {
      const html = panel(value, MANAGER);
      expect(leftoverText(withoutData(html.replace(/\u00a0/g, " "), DATA))).toBe("");
    }
  });

  it("shows the waybill's number, status, journal and the actions its status allows", () => {
    const html = panel(order({ shipments: [shipment()] }), MANAGER);
    expect(html).toContain("FAKE000001");
    expect(html).toContain("§shipment.status.created");
    expect(html).toContain("§shipment.journal.first");
    expect(html).toContain("§shipment.journal.changed");
    for (const action of ["refresh", "cancel", "label"]) {
      expect(html, action).toContain(`§shipment.action.${action}`);
    }
    expect(html).not.toContain("§shipment.action.reconcile");
    // A second waybill is never offered while one is active.
    expect(html).not.toContain('name="shipment-weight"');
    expect(html).toContain("§shipment.create.exists");
  });

  it("offers 'Check with the carrier' for an unknown waybill, says not to create another, and no cancel or label", () => {
    const html = panel(
      order({ shipments: [shipment({ status: "unknown", trackingNumber: null })] }),
      MANAGER,
    );
    expect(html).toContain("§shipment.action.reconcile");
    expect(html).toContain("§shipment.card.unknownBody");
    expect(html).not.toContain("§shipment.action.cancel");
    expect(html).not.toContain("§shipment.action.label");
    expect(html).not.toContain('name="shipment-weight"');
  });

  it("disables every control while a write runs", () => {
    const html = panel(order({ shipments: [shipment()] }), MANAGER, sentinel, { busy: true });
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map((match) => match[0]);
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect(button).toContain("disabled");
  });

  it("gives a reader the snapshot, the journal and the label only: no create form, no refresh, cancel or check", () => {
    const html = panel(order({ shipments: [shipment()] }), ["orders.read"]);
    expect(html).toContain("§shipment.action.label");
    for (const gone of ["refresh", "cancel", "reconcile"]) {
      expect(html, gone).not.toContain(`§shipment.action.${gone}`);
    }
    expect(html).not.toContain("§shipment.create.title");
    const none = panel(order(), ["orders.read"]);
    expect(none).not.toContain("<form");
  });

  it("shows no action and no form to a session that can read nothing of orders (a viewer would not get here)", () => {
    const html = panel(order({ shipments: [shipment()] }), [...ROLE_PERMISSIONS.viewer]);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<form");
  });
});

describe("the create-waybill form", () => {
  it("is on for a paid order and a post form without an action", () => {
    const html = panel(order(), MANAGER);
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).not.toMatch(/<form[^>]*action=/);
    expect(html).not.toMatch(/<fieldset[^>]*disabled/);
    expect(html).toContain("§shipment.create.intro");
    expect(html).toContain('type="submit"');
  });

  it("is off, with the reason in words, until the order is paid", () => {
    const html = panel(order({ status: "awaiting_payment" }), MANAGER);
    expect(html).toMatch(/<fieldset[^>]*disabled/);
    expect(html).toContain("§shipment.create.notPaidYet");
    expect(html).toContain('aria-describedby="shipment-gate-hint"');
    expect(html).toContain('id="shipment-gate-hint"');
    const fulfilled = panel(order({ status: "fulfilled" }), MANAGER);
    expect(fulfilled).toContain("§shipment.create.notShippable");
    expect(fulfilled).not.toContain("<form");
  });

  it("explains an order without a carrier delivery instead of a form", () => {
    const html = panel(order({ shipping: null }), MANAGER);
    expect(html).toContain("§shipment.create.noCarrier");
    expect(html).not.toContain("<form");
  });

  it("starts with the subtotal as the declared value and the payer from the method", () => {
    const html = panel(order(), MANAGER);
    expect(tag(html, "input", "shipment-declared")).toContain('value="189.00"');
    expect(tag(html, "input", "shipment-declared")).toContain('inputMode="decimal"');
    expect(html).toMatch(/<option value="sender" selected/);
    const onDelivery = order({
      shipping: {
        ...(order().shipping as NonNullable<AdminOrder["shipping"]>),
        payer: "recipient_on_delivery",
      },
    });
    expect(panel(onDelivery, MANAGER)).toMatch(/<option value="recipient" selected/);
  });

  it("labels every field and ties each error to its field", () => {
    const value = order();
    const plan = planShipment(shipmentFormDefaults(value, 2), value, 2);
    expect(plan.ok).toBe(false);
    const issues = plan.ok ? {} : plan.issues;
    const html = renderInRouter(
      <CreateWaybillForm
        t={sentinel}
        gate={{ kind: "ready" }}
        carrier="fake"
        currency="UAH"
        exponent={2}
        values={shipmentFormDefaults(value, 2)}
        onChange={noop}
        issues={issues}
        summary={[{ key: "shipment.error.checkFields" }]}
        busy={false}
        onSubmit={noop}
      />,
    );
    for (const field of [
      "weightGrams",
      "lengthMm",
      "widthMm",
      "heightMm",
      "description",
    ] as const) {
      expect(Object.keys(issues)).toContain(field);
    }
    for (const name of [
      "shipment-weight",
      "shipment-length",
      "shipment-width",
      "shipment-height",
      "description",
    ]) {
      const input = tag(html, "input", name);
      expect(input, name).toContain('aria-invalid="true"');
      const id = /id="([^"]+)"/.exec(input)?.[1] ?? "";
      expect(html, name).toContain(`<label for="${id}"`);
      for (const described of (/aria-describedby="([^"]+)"/.exec(input)?.[1] ?? "").split(" ")) {
        expect(html, `${name} #${described}`).toContain(`id="${described}"`);
      }
    }
    expect(html).toContain("§shipment.error.checkFields");
    expect(SHIPMENT_FIELDS).toContain("declaredValue");
  });
});

describe("the notices", () => {
  const render = (notice: ShipmentNotice | null) =>
    renderInRouter(<ShipmentNoticeView t={sentinel} notice={notice} />);

  it("shows each outcome of a create in words, and never invites a retry after an unknown result", () => {
    expect(render({ kind: "created", trackingNumber: "FAKE000001" })).toContain(
      "§shipment.notice.created",
    );
    const failed = render({
      kind: "failed",
      reason: "rejected",
      providerCodes: ["E_1", "<b>x</b>"],
    });
    expect(failed).toContain("§shipment.notice.failed.rejected");
    expect(failed).toContain("E_1, &lt;b&gt;x&lt;/b&gt;");
    expect(failed).not.toContain("<b>x</b>");
    const unknown = render({ kind: "unknownCreate" });
    expect(unknown).toContain("§shipment.notice.unknownCreate");
    expect(unknown).not.toContain("<button");
    expect(render({ kind: "lostCreate" })).toContain("§shipment.notice.lostCreate");
    expect(render(null)).toBe("");
  });

  it("renders every notice without hardcoded text", () => {
    const notices: ShipmentNotice[] = [
      { kind: "created", trackingNumber: null },
      { kind: "failed", reason: "invalid_credentials", providerCodes: [] },
      { kind: "unknownCreate" },
      { kind: "lostCreate" },
      { kind: "reconciled", found: true },
      { kind: "reconciled", found: false },
      { kind: "refreshed" },
      { kind: "cancelled" },
      { kind: "labelReady" },
      { kind: "lost", action: "cancel" },
    ];
    for (const notice of notices) expect(leftoverText(render(notice)), notice.kind).toBe("");
  });
});
