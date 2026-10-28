import type {
  AdminLocation,
  AdminPrice,
  AdminProduct,
  AdminReservation,
  AdminStockMovement,
  AdminVariant,
  AdminVariantInventory,
} from "@fluxkit/api-client";
import { CURRENCIES } from "@fluxkit/core";
import { createTranslator, type Translator } from "@fluxkit/ui";
import { describe, expect, it } from "vitest";
import {
  leftoverText,
  messagesForArea,
  renderInRouter,
  sentinelTranslator,
} from "../../test-helpers";
import { formatDateTime } from "../../lib/format";
import { MESSAGE_FILES } from "./index";
import { addColumn, gridFrom, setCell, type PriceGrid } from "./prices/price-grid";
import { PricesGridView, priceContext } from "./prices/prices-tab";
import {
  newAdjustmentValues,
  planAdjustment,
  type AdjustmentValues,
} from "./stock/stock-adjustment";
import {
  AdjustmentFormView,
  AdjustmentResultView,
  JournalView,
  LastMovementView,
  LevelsView,
  ReservationsView,
  StockSummaryView,
  adjustmentConfirmation,
  reservationOrderLink,
  type AdjustmentResult,
  type MovementRow,
} from "./stock/stock-tab";
import type { VariantNaming } from "./tabs/variants-tab";

let t: Translator = sentinelTranslator();
const noop = () => undefined;

/** The `disabled` attribute itself: the class list of every `Button` holds `disabled:opacity-50`, which proves nothing. */
const hasDisabledAttribute = (tag: string): boolean => /\sdisabled=""/.test(tag);
const stamp = "2026-10-20T10:00:00.000Z";
const content = { defaultLocale: "uk", locales: ["uk", "en"] };
const naming: VariantNaming = { uiLocale: "en", content, options: new Map() };

const config = {
  defaultLocale: "uk",
  locales: ["uk", "en"],
  shopCurrency: "UAH",
  currencyExponent: 2,
  supportedCurrencies: Object.entries(CURRENCIES).map(([code, exponent]) => ({ code, exponent })),
  pricesIncludeTax: true,
  lowStockThreshold: 5,
  emailDelivery: false,
  onlinePayment: false,
  media: {
    uploadsEnabled: true,
    maxBytes: 10485760,
    contentTypes: ["image/jpeg", "image/png", "image/webp"],
  },
};

function variant(id: string, overrides: Partial<AdminVariant> = {}): AdminVariant {
  return {
    id,
    sku: `SKU-${id.toUpperCase()}`,
    barcode: null,
    title: null,
    optionSignature: "",
    isDefault: false,
    isActive: true,
    trackInventory: true,
    allowBackorder: false,
    attributes: {},
    position: 0,
    optionValues: [],
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

function product(overrides: Partial<AdminProduct> = {}): AdminProduct {
  return {
    id: "p",
    productTypeId: "t",
    brandId: null,
    slug: "p",
    title: { uk: "П" },
    description: null,
    status: "draft",
    attributes: {},
    publishedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
    categories: [],
    media: [],
    options: [],
    variants: [variant("v1", { isDefault: true }), variant("v2", { isActive: false })],
    ...overrides,
  };
}

function price(
  variantId: string,
  currency: string,
  amount: number,
  compareAt: number | null = null,
): AdminPrice {
  return {
    id: `p-${variantId}-${currency}`,
    variantId,
    currency,
    amount,
    compareAtAmount: compareAt,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

const stored = [
  price("v1", "UAH", 123456, 150000),
  price("v1", "JPY", 1500),
  price("v2", "UAH", 5),
];

function grid(target: AdminProduct = product()): PriceGrid {
  return gridFrom(stored, priceContext(config, target));
}

function prices(
  options: {
    canWrite?: boolean;
    canDelete?: boolean;
    status?: AdminProduct["status"];
    grid?: PriceGrid;
    dirty?: boolean;
    issues?: Parameters<typeof PricesGridView>[0]["issues"];
  } = {},
): string {
  const target = product({ status: options.status ?? "draft" });
  return renderInRouter(
    <PricesGridView
      t={t}
      uiLocale="en"
      naming={naming}
      product={target}
      context={priceContext(config, target)}
      stored={stored}
      grid={options.grid ?? grid(target)}
      issues={options.issues ?? {}}
      canWrite={options.canWrite ?? true}
      canDelete={options.canDelete ?? true}
      dirty={options.dirty ?? false}
      busy={false}
      summary={[]}
      onCell={noop}
      onAddColumn={noop}
      onRemoveColumn={noop}
      onRemovePrice={noop}
      onDiscard={noop}
      onSubmit={noop}
    />,
  );
}

function tag(html: string, id: string): string {
  const match = new RegExp(`<[a-z]+[^>]*\\sid="${id}"[^>]*>`).exec(html);
  if (match === null) throw new Error(`no element with id ${id}`);
  return match[0];
}

describe("Prices grid", () => {
  it("shows the shop currency first and the stored currencies after it, each with its decimals", () => {
    const html = prices();
    const headers = [
      ...html.matchAll(/§products\.prices\.(shopCurrencyColumn|wholeUnits|decimals)/g),
    ].map((match) => match[1]);
    expect(headers).toEqual(["shopCurrencyColumn", "decimals", "wholeUnits"]);
    expect(html.indexOf("§products.prices.shopCurrencyColumn")).toBeLessThan(html.indexOf(">JPY<"));
  });

  it("fills the inputs with the exact stored decimal text and names each input by variant and currency", () => {
    const html = prices();
    expect(tag(html, "product-price-v1-UAH-amount")).toContain('value="1234.56"');
    expect(tag(html, "product-price-v1-UAH-compareAt")).toContain('value="1500.00"');
    expect(tag(html, "product-price-v1-JPY-amount")).toContain('value="1500"');
    expect(tag(html, "product-price-v2-UAH-amount")).toContain('value="0.05"');
    expect(tag(html, "product-price-v2-JPY-amount")).toContain('value=""');
    expect(tag(html, "product-price-v1-UAH-amount")).toMatch(/inputmode="decimal"/i);
    expect(html).toMatch(/<form\b[^>]*method="post"/);
    expect(html).not.toMatch(/<form\b[^>]*action=/);
  });

  it("shows a typed change as the value that will be stored, never before it parses", () => {
    const typed = setCell(
      setCell(grid(), "v2", "UAH", "amount", "7.5"),
      "v1",
      "UAH",
      "amount",
      "12,50",
    );
    const html = prices({ grid: typed });
    expect(html.match(/§products\.prices\.willBe/g)).toHaveLength(1);
  });

  it("offers Remove only where the API allows it; the shop price of an active variant of a live product is explained", () => {
    const draft = prices();
    expect(draft.match(/§products\.prices\.removeLabel/g)).toHaveLength(3);
    const live = prices({ status: "active" });
    // v1 is active: its UAH price cannot be removed; its JPY price and v2's (switched off) UAH price can.
    expect(live.match(/§products\.prices\.removeLabel/g)).toHaveLength(2);
    expect(live).toContain("§products.prices.lastShopPrice");
  });

  it("disables Remove while the grid has unsaved changes", () => {
    const html = prices({ dirty: true });
    expect(html).toContain("§products.prices.removeWhileDirty");
    for (const button of html.match(/<button[^>]*§products\.prices\.removeLabel[^>]*>/g) ?? []) {
      expect(hasDisabledAttribute(button), button).toBe(true);
    }
  });

  it("puts an issue on its cell", () => {
    const html = prices({
      issues: { "v2.UAH.amount": { key: "errors.reason.price_missing" } },
    });
    expect(tag(html, "product-price-v2-UAH-amount")).toContain('aria-invalid="true"');
    expect(html).toContain("§errors.reason.price_missing");
  });

  it("offers an empty added column to be hidden, never the shop currency or a column with prices", () => {
    const html = prices({ grid: addColumn(grid(), "EUR", priceContext(config, product())) });
    expect(html.match(/§products\.prices\.hideColumnLabel/g)).toHaveLength(1);
  });

  it("gives a viewer the stored prices formatted from minor units and no control at all", () => {
    const html = prices({ canWrite: false, canDelete: false });
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("§products.prices.addCurrency");
  });
});

describe("Prices grid with the real messages", () => {
  it("formats stored amounts exactly from integer minor units (no float, no rounding)", async () => {
    const sentinel = t;
    try {
      t = createTranslator(await messagesForArea("en", MESSAGE_FILES), "en");
      const html = prices({ canWrite: false, canDelete: false });
      expect(html).toContain("1,234.56");
      expect(html).toContain("1,500.00");
      expect(html).toContain("0.05");
      expect(html).toMatch(/1,500(?![.\d])/);
    } finally {
      t = sentinel;
    }
  });
});

const locations: AdminLocation[] = [
  { id: "loc-main", code: "main", name: "Main", isDefault: true },
  { id: "loc-2", code: "north", name: "North", isDefault: false },
];

const level = (locationId: string, onHand: number, reserved: number) => ({
  locationId,
  locationCode: locationId === "loc-main" ? "main" : "north",
  onHand,
  reserved,
  available: Math.max(0, onHand - reserved),
});

function inventory(
  variantId: string,
  overrides: Partial<AdminVariantInventory> = {},
): AdminVariantInventory {
  return {
    variantId,
    trackInventory: true,
    allowBackorder: false,
    levels: [],
    totalAvailable: 0,
    ...overrides,
  };
}

function movement(id: string, overrides: Partial<AdminStockMovement> = {}): AdminStockMovement {
  return {
    id,
    variantId: "v1",
    locationId: "loc-main",
    locationCode: "main",
    kind: "receipt",
    delta: 5,
    onHandAfter: 5,
    reason: null,
    reference: null,
    actorId: "u-1",
    createdAt: stamp,
    ...overrides,
  };
}

function form(
  values: Partial<AdjustmentValues>,
  where: readonly AdminLocation[] = [locations[0] as AdminLocation],
) {
  return renderInRouter(
    <AdjustmentFormView
      t={t}
      uiLocale="en"
      sku="SKU-V1"
      values={{ ...newAdjustmentValues("loc-main"), ...values }}
      locations={where}
      current={{ onHand: 10, reserved: 4 }}
      issues={{}}
      summary={[]}
      busy={false}
      onChange={noop}
      onSubmit={noop}
    />,
  );
}

describe("Stock views", () => {
  it("summarises every variant with its state as text and tone, and the server's totals", () => {
    const html = renderInRouter(
      <StockSummaryView
        t={t}
        uiLocale="en"
        naming={naming}
        product={product({
          variants: [
            variant("v1"),
            variant("v2"),
            variant("v3", { trackInventory: false }),
            variant("v4"),
          ],
        })}
        inventory={
          new Map([
            ["v1", inventory("v1", { levels: [level("loc-main", 10, 2)], totalAvailable: 8 })],
            ["v2", inventory("v2", { levels: [level("loc-main", 3, 0)], totalAvailable: 3 })],
            ["v3", inventory("v3", { trackInventory: false })],
            ["v4", inventory("v4")],
          ])
        }
        lowStockThreshold={5}
        selected="v1"
        busy={false}
        onSelect={noop}
      />,
    );
    expect(html).toContain("§products.stock.state.in_stock");
    expect(html).toContain("§products.stock.state.low_stock");
    expect(html).toContain("§products.stock.state.not_tracked");
    expect(html).toContain("§products.stock.state.out_of_stock");
    expect(html).toContain(">8<");
    expect(html).toContain("§products.stock.opened");
  });

  it("lists the levels per location by name", () => {
    const html = renderInRouter(
      <LevelsView
        t={t}
        uiLocale="en"
        sku="SKU-V1"
        locations={locations}
        stock={inventory("v1", { levels: [level("loc-2", 7, 1)] })}
      />,
    );
    expect(html).toContain("North (north)");
    expect(html).toContain(">7<");
    expect(
      renderInRouter(
        <LevelsView t={t} uiLocale="en" sku="S" locations={locations} stock={undefined} />,
      ),
    ).toContain("§products.stock.noLevels");
  });

  it("shows a location picker only when there is more than one location", () => {
    expect(form({})).not.toContain('id="stock-location"');
    expect(form({}, locations)).toContain('id="stock-location"');
  });

  it("offers exactly the API's three kinds, and the counted quantity only for a correction", () => {
    const html = form({});
    expect(html.match(/<option value="(receipt|adjustment|return)"/g)).toHaveLength(3);
    expect(html).not.toContain('value="sale"');
    expect(html).not.toContain('type="radio"');
    const correction = form({ kind: "adjustment" });
    expect(correction.match(/type="radio"/g)).toHaveLength(2);
    expect(correction).toMatch(/<form\b[^>]*method="post"/);
    expect(correction).not.toMatch(/<form\b[^>]*action=/);
    expect(correction).toContain("§products.stock.currentLevel");
  });

  it("disables the send button while a change is being sent or the journal is read", () => {
    const busy = renderInRouter(
      <AdjustmentFormView
        t={t}
        uiLocale="en"
        sku="S"
        values={newAdjustmentValues("loc-main")}
        locations={locations}
        current={{ onHand: 0, reserved: 0 }}
        issues={{}}
        summary={[]}
        busy
        onChange={noop}
        onSubmit={noop}
      />,
    );
    expect(busy).toMatch(/<button[^>]*type="submit"[^>]*\sdisabled=""/);
    expect(busy).toContain("§products.stock.sending");
  });

  it("states the change in the confirmation of a lowering and of a counted quantity", () => {
    const lower = planAdjustment(
      { ...newAdjustmentValues("loc-main"), kind: "adjustment", quantity: "-3" },
      { onHand: 10, reserved: 0 },
      { locationCount: 1 },
    );
    const set = planAdjustment(
      { ...newAdjustmentValues("loc-main"), kind: "adjustment", mode: "setOnHand", quantity: "4" },
      { onHand: 10, reserved: 0 },
      { locationCount: 1 },
    );
    if (!lower.ok || !set.ok) throw new Error("plans");
    expect(adjustmentConfirmation(t, "en", lower, "S", "Main").title).toBe(
      "§products.stock.confirmLowerTitle",
    );
    expect(adjustmentConfirmation(t, "en", set, "S", "Main").title).toBe(
      "§products.stock.confirmSetTitle",
    );
  });

  it("shows the result of an adjustment only from the server: the movement, a refusal, or the journal's answer", () => {
    const row: MovementRow = { movement: movement("m1"), actor: { kind: "you" } };
    const results: AdjustmentResult[] = [
      { kind: "ok", row },
      { kind: "refused" },
      { kind: "unknown", check: "new_by_you", latest: row },
      { kind: "unknown", check: "none_new", latest: null },
      { kind: "unknown", check: "unreadable", latest: null },
    ];
    const html = results.map((result) =>
      renderInRouter(<AdjustmentResultView t={t} uiLocale="en" result={result} />),
    );
    expect(html[0]).toContain("§products.stock.result.okTitle");
    expect(html[1]).toContain("§products.stock.result.refusedTitle");
    expect(html[2]).toContain("§dict.unknown.title");
    expect(html[2]).toContain("§products.stock.result.new_by_you");
    expect(html[2]).toContain("§products.stock.lastMovement");
    expect(html[3]).toContain("§products.stock.result.none_new");
    expect(html[4]).toContain("§products.stock.result.unreadable");
    expect(
      renderInRouter(<AdjustmentResultView t={t} uiLocale="en" result={null} />),
    ).not.toContain("§products.stock.result");
  });

  it("pages the journal and names the actor", () => {
    const rows: MovementRow[] = [
      {
        movement: movement("m2", { kind: "adjustment", delta: -2, onHandAfter: 3 }),
        actor: { kind: "you" },
      },
      {
        movement: movement("m1", { actorId: null, kind: "sale", reference: "FK-1" }),
        actor: { kind: "system" },
      },
    ];
    const html = renderInRouter(
      <JournalView
        t={t}
        uiLocale="en"
        sku="S"
        rows={rows}
        offset={20}
        total={42}
        busy={false}
        onOffset={noop}
      />,
    );
    expect(html).toContain("§products.stock.actor.you");
    expect(html).toContain("§products.stock.actor.system");
    expect(html).toContain("§products.stock.kindLabel.sale");
    expect(html).toMatch(/[-−]2</);
    expect(html).toContain("§products.stock.referenceValue");
    expect(html).toContain("§products.stock.newer");
    expect(renderInRouter(<LastMovementView t={t} uiLocale="en" last={null} />)).toContain(
      "§products.stock.noMovements",
    );
  });

  it("links a reservation to its order by number, else by id", () => {
    const reservation = (reference: string | null, orderId: string | null): AdminReservation => ({
      status: "active",
      quantity: 2,
      expiresAt: stamp,
      reference,
      orderId,
      locationCode: "main",
      createdAt: stamp,
    });
    expect(reservationOrderLink(reservation("FK-2026-0001", "o-1"))).toBe("/orders?q=FK-2026-0001");
    expect(reservationOrderLink(reservation(null, "o-1"))).toBe("/orders?q=o-1");
    expect(reservationOrderLink(reservation(null, null))).toBeNull();
    const html = renderInRouter(
      <ReservationsView
        t={t}
        uiLocale="en"
        sku="S"
        status="active"
        rows={[reservation("FK-2026-0001", "o-1")]}
        offset={0}
        total={1}
        busy={false}
        onStatus={noop}
        onOffset={noop}
      />,
    );
    expect(html).toContain('href="/admin-ui/orders?q=FK-2026-0001"');
    expect(html.match(/<option value="(active|committed|released|expired)"/g)).toHaveLength(4);
  });
});

describe("the Prices and Stock views with the real uk and en messages", () => {
  it("render every piece without a missing key", async () => {
    const sentinel = t;
    try {
      for (const locale of ["uk", "en"] as const) {
        t = createTranslator(await messagesForArea(locale, MESSAGE_FILES), locale);
        for (const canWrite of [true, false]) {
          for (const status of ["draft", "active"] as const) {
            expect(prices({ canWrite, canDelete: canWrite, status, dirty: true })).toContain(
              "<table",
            );
          }
        }
        for (const kind of ["receipt", "adjustment", "return"] as const) {
          expect(form({ kind }, locations)).toContain("<form");
          expect(form({ kind, mode: "setOnHand" })).toContain("<form");
        }
        const row: MovementRow = {
          movement: movement("m1"),
          actor: { kind: "other", shortId: "u-2" },
        };
        for (const result of [
          { kind: "ok", row },
          { kind: "refused" },
          { kind: "unknown", check: "new_by_other", latest: row },
        ] as AdjustmentResult[]) {
          expect(
            renderInRouter(<AdjustmentResultView t={t} uiLocale={locale} result={result} />),
          ).toContain("<div");
        }
        for (const status of ["active", "committed", "released", "expired"] as const) {
          expect(
            renderInRouter(
              <ReservationsView
                t={t}
                uiLocale={locale}
                sku="S"
                status={status}
                rows={[]}
                offset={0}
                total={0}
                busy={false}
                onStatus={noop}
                onOffset={noop}
              />,
            ),
          ).toContain("<table");
        }
      }
    } finally {
      t = sentinel;
    }
  });

  it("leave no untranslated word in the sentinel rendering", () => {
    let text =
      prices() +
      prices({ status: "active", dirty: true }) +
      form({ kind: "adjustment" }, locations) +
      renderInRouter(
        <JournalView
          t={t}
          uiLocale="en"
          sku="SKU-V1"
          rows={[{ movement: movement("m1"), actor: { kind: "system" } }]}
          offset={0}
          total={1}
          busy={false}
          onOffset={noop}
        />,
      );
    for (const value of [
      "SKU-V1",
      "SKU-V2",
      "North (north)",
      "Main (main)",
      formatDateTime(stamp, "en"),
      "+5",
      "main",
      ...Object.keys(CURRENCIES),
    ]) {
      text = text.split(value).join(" ");
    }
    expect(leftoverText(text)).toBe("");
  });
});
