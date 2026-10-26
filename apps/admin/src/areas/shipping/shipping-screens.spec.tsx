import type { AdminConfig, AdminShippingMethod } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import {
  leftoverText,
  messagesForArea,
  renderInRouter,
  sentinelTranslator,
} from "../../test-helpers";
import { MESSAGE_FILES } from "./index";
import { emptyMethodForm, methodFormFrom, type MethodFormValues } from "./method-form";
import { MethodFormView } from "./method-form-view";
import { MethodsView, type MethodListState } from "./methods-page";
import { PricingFields } from "./pricing-fields";
import { MAX_TIERS, emptyPricingValues } from "./pricing-form";
import { CheckResult, ProviderNotEnabled, ProvidersView, SaveResult } from "./provider-pages";

const sentinel = sentinelTranslator();
const noop = () => undefined;

const config: AdminConfig = {
  defaultLocale: "uk",
  locales: ["uk", "en"],
  shopCurrency: "UAH",
  currencyExponent: 2,
  supportedCurrencies: [{ code: "UAH", exponent: 2 }],
  pricesIncludeTax: true,
  lowStockThreshold: 5,
  emailDelivery: false,
  media: { uploadsEnabled: true, maxBytes: 10485760, contentTypes: ["image/jpeg"] },
};
const content = { defaultLocale: "uk", locales: ["uk", "en"] } as const;

function method(overrides: Partial<AdminShippingMethod> = {}): AdminShippingMethod {
  return {
    id: "0b5f8a52-7a9e-4c7a-9d0e-1a2b3c4d5e6f",
    code: "courier",
    title: { uk: "Кур'єр", en: "<b>Courier</b>" },
    description: null,
    kind: "address",
    providerCode: "fake",
    providerService: "express",
    pricing: { type: "flat", amount: 8050 },
    currency: "UAH",
    countryCodes: ["UA"],
    isActive: true,
    position: 0,
    createdAt: "2026-10-24T10:00:00.000Z",
    updatedAt: "2026-10-24T10:00:00.000Z",
    ...overrides,
  };
}

/** The opening tag of the `<input>` with this name. */
function inputTag(html: string, name: string): string {
  const found = [...html.matchAll(/<input[^>]*>/g)]
    .map((match) => match[0])
    .find((tag) => tag.includes(`name="${name}"`));
  if (found === undefined) throw new Error(`No <input name="${name}">`);
  return found;
}

/** The markup with the given data texts (as React escapes them) removed, so only words for people are left. */
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

function list(
  state: MethodListState,
  options: { canManage?: boolean; offset?: number } = {},
  t = sentinel,
) {
  return renderInRouter(
    <MethodsView
      t={t}
      uiLocale="en"
      defaultLocale="uk"
      config={config}
      canManage={options.canManage ?? true}
      state={state}
      onRetry={noop}
      limit={50}
      offset={options.offset ?? 0}
      hrefForOffset={(offset) => `/shipping?offset=${String(offset)}`}
    />,
    "/shipping",
  );
}

describe("the delivery methods list", () => {
  const page = (items: AdminShippingMethod[], total = items.length): MethodListState => ({
    status: "ready",
    data: { items, total },
  });

  it("renders every state without hardcoded text", () => {
    const states: MethodListState[] = [
      { status: "loading" },
      page([method(), method({ id: "x", code: "post", isActive: false, kind: "pickup_point" })]),
      page([]),
      { status: "forbidden" },
      { status: "notFound" },
      { status: "error", failure: { kind: "network" } },
    ];
    for (const state of states) {
      const html = list(state);
      expect(
        leftoverText(
          withoutData(html, ["courier", "post", "<b>Courier</b>", "fake / express", "fake"]),
        ),
        state.status,
      ).toBe("");
    }
  });

  it("links each row, shows kind, carrier, price and status, and renders titles as text", () => {
    const html = list(page([method()]));
    expect(html).toContain(
      'href="/admin-ui/shipping/methods/0b5f8a52-7a9e-4c7a-9d0e-1a2b3c4d5e6f"',
    );
    expect(html).toContain("§ship.kind.address");
    expect(html).toContain("fake / express");
    expect(html).toContain("§ship.status.active");
    expect(html).not.toContain("<b>Courier</b>");
    expect(html).toContain("&lt;b&gt;Courier&lt;/b&gt;");
  });

  it("summarises every price type in words", () => {
    const html = list(
      page([
        method({ pricing: { type: "flat", amount: 8050 } }),
        method({
          id: "b",
          code: "b",
          pricing: { type: "free_over", amount: 8000, freeFrom: 200050 },
        }),
        method({
          id: "c",
          code: "c",
          pricing: { type: "tiers", tiers: [{ fromSubtotal: 0, amount: 1 }] },
        }),
        method({ id: "d", code: "d", pricing: { type: "carrier_on_delivery" } }),
      ]),
    );
    expect(html).toContain("§ship.pricing.summary.flat");
    expect(html).toContain("§ship.pricing.summary.carrier_on_delivery");
  });

  it("offers the create action only to a session that may manage shipping", () => {
    expect(list(page([]), { canManage: true })).toContain("/admin-ui/shipping/methods/new");
    expect(list(page([]), { canManage: false })).not.toContain("/admin-ui/shipping/methods/new");
  });

  it("explains a page past the end instead of an empty shop", () => {
    const html = list(page([], 3), { offset: 100 });
    expect(html).toContain("§dict.list.pastEnd");
    expect(html).not.toContain("§ship.list.emptyTitle");
  });
});

function form(
  values: MethodFormValues,
  options: {
    mode?: "create" | "edit";
    canManage?: boolean;
    issues?: Parameters<typeof MethodFormView>[0]["issues"];
  } = {},
  t = sentinel,
) {
  return renderInRouter(
    <MethodFormView
      t={t}
      uiLocale="en"
      content={content}
      mode={options.mode ?? "create"}
      idPrefix="method"
      values={values}
      onChange={noop}
      issues={options.issues ?? {}}
      summary={[]}
      busy={false}
      canManage={options.canManage ?? true}
      onSubmit={noop}
      cancelTo="/shipping"
      currency="UAH"
      exponent={2}
    />,
    "/shipping/methods/new",
  );
}

describe("the delivery method form", () => {
  it("renders without hardcoded text, in create and in edit", () => {
    const stored = methodFormFrom(method(), ["uk", "en"], 2, "UAH");
    for (const html of [
      form(emptyMethodForm(["uk", "en"])),
      form(stored, { mode: "edit" }),
      form({ ...stored, kind: "store_pickup" }, { mode: "edit" }),
      form({ ...stored, pricing: emptyPricingValues("tiers") }),
      form({ ...stored, pricing: emptyPricingValues("free_over") }),
      form({ ...stored, pricing: emptyPricingValues("carrier_on_delivery") }),
    ]) {
      expect(
        leftoverText(
          withoutData(html, ["courier", "Кур'єр", "<b>Courier</b>", "fake", "express", "UAH"]),
        ),
      ).toBe("");
    }
  });

  it("is a post form without an action, so a submit before the script runs never puts values in a URL", () => {
    const html = form(emptyMethodForm(["uk", "en"]));
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).not.toMatch(/<form[^>]*action=/);
  });

  it("lets the code be typed on create and shows it read-only on edit (it is never renamed)", () => {
    const stored = methodFormFrom(method(), ["uk", "en"], 2, "UAH");
    const create = form(emptyMethodForm(["uk", "en"]));
    const edit = form(stored, { mode: "edit" });
    expect(inputTag(create, "code")).not.toContain("readOnly");
    expect(inputTag(edit, "code")).toContain('readOnly=""');
    expect(edit).toContain("§ship.form.codeHintEdit");
  });

  it("shows the typed price as decimals with the currency code from the config, never a symbol", () => {
    const stored = methodFormFrom(method(), ["uk", "en"], 2, "UAH");
    const html = form(stored, { mode: "edit" });
    expect(inputTag(html, "method-pricing-amount")).toContain('value="80.50"');
    expect(inputTag(html, "method-pricing-amount")).toContain('inputMode="decimal"');
    expect(html).not.toMatch(/₴|\$|€|£/);
  });

  it("hides the carrier fields for a store pickup and requires the carrier for a pickup point", () => {
    const stored = methodFormFrom(method(), ["uk", "en"], 2, "UAH");
    const pickup = form({ ...stored, kind: "pickup_point" });
    expect(pickup).toContain("§ship.form.providerCodeHintRequired");
    expect(inputTag(pickup, "providerCode")).toContain('required=""');
    expect(inputTag(form({ ...stored, kind: "address" }), "providerCode")).not.toContain(
      "required",
    );
    const store = form({ ...stored, kind: "store_pickup" });
    expect(store).not.toContain('name="providerCode"');
    expect(store).toContain("§ship.form.noCarrierForPickup");
    expect(store).toContain("§ship.form.descriptionHintPickup");
  });

  it("ties a server or local error to its field and marks it invalid", () => {
    const html = form(emptyMethodForm(["uk", "en"]), {
      issues: {
        code: { key: "ship.error.codeFormat" },
        countryCodes: { key: "ship.error.countryFormat", values: { code: "X" } },
        "pricing.amount": { key: "ship.money.empty" },
      },
    });
    for (const name of ["code", "countryCodes", "method-pricing-amount"]) {
      const input = inputTag(html, name);
      expect(input, name).toContain('aria-invalid="true"');
      const described = /aria-describedby="([^"]+)"/.exec(input)?.[1] ?? "";
      expect(described, name).toMatch(/-error/);
      for (const id of described.split(" "))
        expect(html, `${name}: #${id}`).toContain(`id="${id}"`);
    }
  });

  it("has no actions and no editable control for a session that may not manage shipping", () => {
    const html = form(methodFormFrom(method(), ["uk", "en"], 2, "UAH"), {
      mode: "edit",
      canManage: false,
    });
    expect(html).not.toContain('type="submit"');
    expect(html).not.toContain("§ship.pricing.addTier");
    expect(html).toMatch(/<select[^>]*disabled/);
  });

  it("warns on a method priced in another currency and shows empty amount fields", () => {
    const old = method({ currency: "EUR" });
    const stored = methodFormFrom(old, ["uk", "en"], 2, "UAH");
    const html = renderInRouter(
      <MethodFormView
        t={sentinel}
        uiLocale="en"
        content={content}
        mode="edit"
        idPrefix="method"
        values={stored}
        onChange={noop}
        issues={{}}
        summary={[]}
        busy={false}
        canManage
        onSubmit={noop}
        cancelTo="/shipping"
        currency="UAH"
        exponent={2}
        pricingNotice="NOTICE-TEXT"
      />,
    );
    expect(html).toContain("NOTICE-TEXT");
    expect(inputTag(html, "method-pricing-amount")).toContain('value=""');
  });
});

describe("the pricing fields", () => {
  function fields(values: ReturnType<typeof emptyPricingValues>, readOnly = false) {
    return renderInRouter(
      <PricingFields
        t={sentinel}
        idPrefix="p"
        values={values}
        onChange={noop}
        issues={{}}
        currency="UAH"
        exponent={2}
        readOnly={readOnly}
      />,
    );
  }

  it("shows the fields of the chosen type only", () => {
    expect(fields(emptyPricingValues("flat"))).toContain('name="p-amount"');
    expect(fields(emptyPricingValues("flat"))).not.toContain('name="p-freeFrom"');
    expect(fields(emptyPricingValues("free_over"))).toContain('name="p-freeFrom"');
    expect(fields(emptyPricingValues("carrier_on_delivery"))).not.toContain('name="p-amount"');
    expect(fields(emptyPricingValues("tiers"))).toContain('name="p-tier-0-from"');
  });

  it("allows tiers up to the maximum and no more, and never removes the only tier", () => {
    const tiers = (count: number) => ({
      ...emptyPricingValues("tiers"),
      tiers: Array.from({ length: count }, () => ({ fromSubtotal: "0", amount: "1" })),
    });
    expect(fields(tiers(1))).not.toContain("§ship.pricing.removeTier");
    expect(fields(tiers(2))).toContain("§ship.pricing.removeTier");
    expect(fields(tiers(MAX_TIERS - 1))).toMatch(/<button[^>]*id="p-add-tier"(?![^>]*disabled)/);
    const full = fields(tiers(MAX_TIERS));
    expect(full).toMatch(/<button[^>]*id="p-add-tier"[^>]*disabled/);
    expect(full).toContain("§ship.pricing.maxTiers");
  });

  it("has no add or remove controls when read-only", () => {
    const html = fields(emptyPricingValues("tiers"), true);
    expect(html).not.toContain("§ship.pricing.addTier");
  });
});

describe("the carriers screens", () => {
  const providers = (codes: string[] | null, typed = "", partial = false) =>
    renderInRouter(
      <ProvidersView t={sentinel} codes={codes} partial={partial} typed={typed} onTyped={noop} />,
      "/shipping/providers",
    );

  it("renders every state without hardcoded text and links a carrier by its code", () => {
    for (const html of [
      providers(null),
      providers([]),
      providers(["fake", "nova_poshta"], "x_1", true),
    ]) {
      expect(leftoverText(withoutData(html, ["fake", "nova_poshta", "x_1"]))).toBe("");
    }
    expect(providers(["fake"])).toContain('href="/admin-ui/shipping/providers/fake"');
  });

  it("opens a typed code only when it has the shape of a code, and says so otherwise", () => {
    expect(providers([], "my_carrier")).toContain('href="/admin-ui/shipping/providers/my_carrier"');
    const bad = providers([], "Bad Code");
    expect(bad).not.toContain("/admin-ui/shipping/providers/Bad");
    expect(bad).toContain("§ship.error.codeFormat");
    expect(bad).toContain('aria-disabled="true"');
  });

  it("tells that API keys are environment variables and offers no field for a key", () => {
    const html = providers(["fake"]);
    expect(html).toContain("§ship.providers.credentialsBody");
    expect(html).not.toMatch(/type="password"/);
    expect(html).not.toMatch(/name="[^"]*(key|token|secret|password)[^"]*"/i);
  });

  it("explains a carrier the shop does not run", () => {
    const html = renderInRouter(<ProviderNotEnabled t={sentinel} code="ghost" />);
    expect(html).toContain("§ship.provider.notEnabledTitle");
    expect(html).toContain("§ship.provider.notEnabledBody");
  });
});

describe("the connection check result", () => {
  const render = (view: Parameters<typeof CheckResult>[0]["view"]) =>
    renderInRouter(<CheckResult t={sentinel} view={view} />);

  it("says ok, or the translated reason, and lists raw carrier codes as plain text", () => {
    expect(render({ kind: "ok" })).toContain("§ship.check.ok");
    for (const reason of ["unavailable", "rejected", "invalid_credentials", "not_supported"]) {
      const html = render({ kind: "failed", reason, providerCodes: ["E_1", "<b>x</b>"] });
      expect(html).toContain(`§ship.check.reason.${reason}`);
      expect(html).toContain("E_1, &lt;b&gt;x&lt;/b&gt;");
      expect(html).not.toContain("<b>x</b>");
    }
    expect(render({ kind: "unknown" })).toContain("§ship.check.unknownBody");
    expect(render({ kind: "idle" })).toBe("");
  });

  it("renders without hardcoded text", () => {
    const views = [
      { kind: "ok" as const },
      { kind: "failed" as const, reason: "rejected", providerCodes: [] },
      { kind: "running" as const },
      { kind: "unknown" as const },
      { kind: "problem" as const, descriptor: { key: "errors.code.too_many_requests" } },
    ];
    for (const view of views) expect(leftoverText(render(view)), view.kind).toBe("");
  });
});

describe("the save result", () => {
  it("lists every refused path with its friendly reason, the credential one included", () => {
    const html = renderInRouter(
      <SaveResult
        t={sentinel}
        view={{
          kind: "refused",
          top: null,
          more: true,
          issues: [
            {
              path: "settings.sender.apiKey",
              descriptor: { key: "ship.reason.secret_not_allowed" },
            },
            { path: "settings.<i>x</i>", descriptor: { key: "ship.reason.too_deep" } },
          ],
        }}
      />,
    );
    expect(html).toContain("settings.sender.apiKey");
    expect(html).toContain("§ship.reason.secret_not_allowed");
    expect(html).toContain("settings.&lt;i&gt;x&lt;/i&gt;");
    expect(html).toContain("§ship.settings.moreIssues");
  });
});

describe("messages built from data exist in uk and en within the files the area loads", () => {
  it("covers kinds, statuses, price types, money and field reasons, check reasons and refusals", async () => {
    const { SHIPPING_REASONS, CHECK_REASONS, METHOD_REFUSAL_RULES } =
      await import("./shipping-errors");
    const { METHOD_KINDS } = await import("./method-form");
    const { PRICING_TYPES } = await import("./pricing-form");
    const keys = [
      ...METHOD_KINDS.flatMap((kind) => [`ship.kind.${kind}`, `ship.kind.hint.${kind}`]),
      "ship.status.active",
      "ship.status.inactive",
      ...PRICING_TYPES.flatMap((type) => [
        `ship.pricing.type.${type}`,
        `ship.pricing.explain.${type}`,
        `ship.pricing.summary.${type}`,
      ]),
      ...[
        "empty",
        "comma_separator",
        "inner_space",
        "invalid_format",
        "too_many_decimals",
        "negative_zero",
        "negative_amount",
        "amount_out_of_range",
      ].map((reason) => `ship.money.${reason}`),
      ...SHIPPING_REASONS.map((reason) => `ship.reason.${reason}`),
      ...CHECK_REASONS.map((reason) => `ship.check.reason.${reason}`),
      ...METHOD_REFUSAL_RULES.map((rule) => `ship.refusal.${rule}`),
    ];
    for (const locale of ["uk", "en"] as const) {
      const messages = await messagesForArea(locale, MESSAGE_FILES);
      for (const key of keys) expect(key in messages, `${locale}: ${key}`).toBe(true);
    }
  });
});
