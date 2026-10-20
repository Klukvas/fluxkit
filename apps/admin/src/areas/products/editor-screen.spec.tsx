import type {
  AdminAttributeWithOptions,
  AdminProduct,
  AdminProductTypeAttribute,
  AdminProductTypeDetail,
  AttributeInputType,
} from "@fluxkit/api-client";
import { createTranslator, type Translator } from "@fluxkit/ui";
import { describe, expect, it } from "vitest";
import {
  leftoverText,
  messagesForArea,
  renderInRouter,
  sentinelTranslator,
} from "../../test-helpers";
import { AttributeFieldsView } from "./attribute-fields-view";
import { attributeFieldSpecs, attributeFormFrom } from "./attribute-values-form";
import { EDITOR_NOTICE_KINDS, EditorNoticeBar } from "./editor-notice";
import {
  LifecycleActionsView,
  ProductSummaryView,
  PublishProblemsView,
  TabProblemsView,
} from "./editor-views";
import { MESSAGE_FILES } from "./index";
import { LIFECYCLE_ACTIONS } from "./lifecycle";
import { mapPublishProblems } from "./publish-problems";
import { CategoryAssignmentsView } from "./tabs/categories-tab";
import { ComingTabView } from "./tabs/coming-tabs";

let t: Translator = sentinelTranslator();
const noop = () => undefined;
const content = { defaultLocale: "uk", locales: ["uk", "en"] };

function attribute(
  code: string,
  inputType: AttributeInputType,
  overrides: Partial<AdminAttributeWithOptions> = {},
): AdminAttributeWithOptions {
  return {
    id: `id-${code}`,
    code,
    name: { uk: `${code}-name-uk`, en: `${code}-name-en` },
    description: null,
    inputType,
    isLocalized: false,
    unit: null,
    validation: {},
    isFilterable: false,
    isSearchable: false,
    isVisibleOnStorefront: true,
    isComparable: false,
    isSortable: false,
    isInternal: false,
    createdAt: "2026-10-19T10:00:00.000Z",
    updatedAt: "2026-10-19T10:00:00.000Z",
    options: [],
    ...overrides,
  };
}

const option = (code: string, position: number) => ({
  id: `opt-${code}`,
  attributeId: "a",
  code,
  label: { uk: `${code}-label-uk`, en: `${code}-label-en` },
  position,
  createdAt: "2026-10-19T10:00:00.000Z",
  updatedAt: "2026-10-19T10:00:00.000Z",
});

function assign(
  definition: AdminAttributeWithOptions,
  level: "product" | "variant" = "product",
  isRequired = false,
): AdminProductTypeAttribute {
  return {
    productTypeId: "type",
    attributeId: definition.id,
    attributeCode: definition.code,
    level,
    isRequired,
    position: 0,
    createdAt: "2026-10-19T10:00:00.000Z",
    attribute: definition,
  };
}

const productType: AdminProductTypeDetail = {
  id: "type",
  code: "sample_type",
  name: { uk: "Тип", en: "Sample type" },
  requiresShipping: true,
  createdAt: "2026-10-19T10:00:00.000Z",
  updatedAt: "2026-10-19T10:00:00.000Z",
  options: [],
  attributes: [
    assign(attribute("a_text", "text", { validation: { max_length: 30 } }), "product", true),
    assign(attribute("b_local", "text", { isLocalized: true })),
    assign(attribute("c_number", "number", { unit: "mm" })),
    assign(attribute("d_bool", "boolean")),
    assign(attribute("e_select", "select", { options: [option("one", 1), option("two", 0)] })),
    assign(attribute("f_multi", "multiselect", { options: [option("x", 0), option("y", 1)] })),
    assign(attribute("g_date", "date")),
    assign(attribute("h_internal", "text", { isInternal: true, isVisibleOnStorefront: false })),
    assign(attribute("z_variant_only", "number"), "variant"),
  ],
};

function product(overrides: Partial<AdminProduct> = {}): AdminProduct {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    productTypeId: "type",
    brandId: null,
    slug: "first-product",
    title: { uk: "Перший", en: "First" },
    description: null,
    status: "draft",
    attributes: { e_select: "gone_option", f_multi: ["y"] },
    publishedAt: null,
    createdAt: "2026-10-19T10:00:00.000Z",
    updatedAt: "2026-10-20T10:00:00.000Z",
    categories: [],
    media: [],
    variants: [
      {
        id: "v1",
        sku: "SKU-ONE",
        barcode: null,
        title: null,
        optionSignature: "",
        isDefault: true,
        isActive: true,
        trackInventory: true,
        allowBackorder: false,
        attributes: {},
        position: 0,
        optionValues: [],
        createdAt: "2026-10-19T10:00:00.000Z",
        updatedAt: "2026-10-19T10:00:00.000Z",
      },
    ],
    options: [],
    ...overrides,
  };
}

const specs = attributeFieldSpecs(productType);

function attributesForm(
  canWrite: boolean,
  mode: "draft" | "publish" = "draft",
  issues: Record<string, { key: string }> = {},
) {
  return renderInRouter(
    <AttributeFieldsView
      t={t}
      uiLocale="en"
      content={content}
      specs={specs}
      values={attributeFormFrom(specs, product().attributes, content.locales)}
      onChange={noop}
      issues={issues}
      summary={[]}
      busy={false}
      canWrite={canWrite}
      mode={mode}
      onSubmit={noop}
    />,
  );
}

const controlTag = (html: string, id: string) =>
  new RegExp(`<(?:input|select|textarea)\\b[^>]*\\bid="${id}"[^>]*>`).exec(html)?.[0] ?? "";

describe("generated attribute form screen", () => {
  it("renders one field per product-level attribute, by input type, never the variant-level one", () => {
    const html = attributesForm(true);
    expect(controlTag(html, "product-attribute-a_text")).toMatch(/type="text"/);
    expect(controlTag(html, "product-attribute-a_text")).toContain('maxLength="30"');
    expect(controlTag(html, "product-attribute-b_local-uk")).not.toBe("");
    expect(controlTag(html, "product-attribute-b_local-en")).not.toBe("");
    expect(controlTag(html, "product-attribute-c_number")).toContain('inputMode="decimal"');
    expect(html).toContain("§products.attributes.labelWithUnit");
    expect(controlTag(html, "product-attribute-d_bool")).toMatch(/^<select/);
    expect(controlTag(html, "product-attribute-e_select")).toMatch(/^<select/);
    expect(html).toContain("two-label-en");
    expect(html.indexOf("two-label-en")).toBeLessThan(html.indexOf("one-label-en"));
    expect(controlTag(html, "product-attribute-f_multi")).toMatch(/type="checkbox"/);
    expect(controlTag(html, "product-attribute-f_multi-1")).toContain("checked");
    expect(controlTag(html, "product-attribute-g_date")).toContain('type="date"');
    expect(html).not.toContain("z_variant_only");
    expect(html).toMatch(/<form\b[^>]*method="post"/);
    expect(html).toContain("§products.form.save");
  });

  it("marks an internal attribute with a badge, and keeps a stored choice that is no longer an option", () => {
    const html = attributesForm(true);
    expect(html.match(/§products\.attributes\.internal/g)).toHaveLength(1);
    expect(html).toContain("§products.attributes.unknownChoice");
  });

  it("requires the required attribute natively only for an active product; a draft says it is needed to publish", () => {
    const draft = attributesForm(true, "draft");
    expect(controlTag(draft, "product-attribute-a_text")).not.toContain("required");
    expect(draft).toContain("§products.attributes.requiredToPublish");
    const live = attributesForm(true, "publish");
    expect(controlTag(live, "product-attribute-a_text")).toContain("required");
  });

  it("puts a server error on its attribute's field", () => {
    const html = attributesForm(true, "draft", {
      "attributes.c_number": { key: "products.attributeReason.above_max" },
    });
    expect(controlTag(html, "product-attribute-c_number")).toContain('aria-invalid="true"');
    expect(html).toContain("§products.attributeReason.above_max");
  });

  it("is read-only for a viewer: no button, inputs read-only, choices disabled", () => {
    const html = attributesForm(false);
    expect(html).not.toContain("<button");
    expect(controlTag(html, "product-attribute-a_text")).toContain('readOnly=""');
    expect(controlTag(html, "product-attribute-e_select")).toContain('disabled=""');
    expect(controlTag(html, "product-attribute-f_multi")).toContain('disabled=""');
  });
});

describe("editor summary, lifecycle and publish problems", () => {
  it("shows the title as the one h1, the status as text, the type and the dates", () => {
    const html = renderInRouter(
      <ProductSummaryView
        t={t}
        uiLocale="en"
        content={content}
        product={product()}
        productType={productType}
        actions={null}
      />,
    );
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toContain(">First<");
    expect(html).toContain("§products.status.draft");
    expect(html).toContain("§products.summary.neverPublished");
  });

  it("offers the permitted actions; locked while a tab has unsaved changes; nothing for a viewer", () => {
    const actions = renderInRouter(
      <LifecycleActionsView
        t={t}
        actions={["publish", "archive", "delete"]}
        busy={null}
        locked={false}
        onAction={noop}
      />,
    );
    for (const action of ["publish", "archive", "delete"]) {
      expect(actions).toContain(`§products.lifecycle.${action}`);
    }
    expect(actions).not.toContain('disabled=""');
    const locked = renderInRouter(
      <LifecycleActionsView t={t} actions={["publish"]} busy={null} locked onAction={noop} />,
    );
    expect(locked).toContain('disabled=""');
    expect(locked).toContain("§products.lifecycle.locked");
    expect(
      renderInRouter(
        <LifecycleActionsView t={t} actions={[]} busy={null} locked={false} onAction={noop} />,
      ),
    ).toBe("");
  });

  it("lists each publish problem with its place and a link to its tab", () => {
    const problems = mapPublishProblems(
      {
        type: "about:blank",
        title: "Bad Request",
        status: 400,
        code: "validation_failed",
        detail: "x",
        errors: [
          { path: "title.uk", code: "empty" },
          { path: "attributes.a_text", code: "required" },
          { path: "variants.0", code: "price_missing" },
          { path: "elsewhere", code: "brand_new_code" },
        ],
      },
      { defaultLocale: "uk", shopCurrency: "UAH", variants: product().variants },
    );
    const html = renderInRouter(
      <PublishProblemsView
        t={t}
        problems={problems}
        visibleTabs={["general", "attributes", "prices"]}
        tabLabel={(tab) => `§products.tab.${tab}`}
        onGoTo={noop}
        onDismiss={noop}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html.match(/§products\.problems\.goTo/g)).toHaveLength(3);
    expect(html).toContain("§products.problems.variantRow");
    expect(html).toContain("§errors.reason.price_missing");
    expect(html).toContain("§errors.reference");
    const prices = renderInRouter(
      <TabProblemsView
        t={t}
        id="product-prices"
        problems={problems.filter((entry) => entry.tab === "prices")}
      />,
    );
    expect(prices).toContain('id="product-prices"');
    expect(prices).toContain("§products.problems.variantRow");
    expect(renderInRouter(<TabProblemsView t={t} id="product-media" problems={[]} />)).toBe("");
    expect(renderInRouter(<ComingTabView t={t} tab="prices" />)).toContain(
      "§products.placeholder.prices",
    );
  });

  it("lists the product's categories with the primary one; controls only for writers", () => {
    const known = new Map([
      [
        "c1",
        {
          id: "c1",
          parentId: null,
          slug: "first",
          name: { uk: "Перша", en: "First cat" },
          description: null,
          position: 0,
          isActive: true,
          createdAt: "x",
          updatedAt: "x",
        },
      ],
    ]);
    const render = (canWrite: boolean) =>
      renderInRouter(
        <CategoryAssignmentsView
          t={t}
          uiLocale="en"
          content={content}
          state={{ ids: ["c1", "99999999-aaaa"], primaryId: "c1" }}
          known={known}
          canWrite={canWrite}
          onPrimary={noop}
          onRemove={noop}
          problems={[]}
        />,
      );
    const writer = render(true);
    expect(writer).toContain('id="product-categories"');
    expect(writer).toContain('role="radiogroup"');
    expect(writer.match(/type="radio"/g)).toHaveLength(2);
    expect(writer).toContain("First cat");
    expect(writer).toContain("99999999");
    expect(writer).toContain("§products.categories.remove");
    const viewer = render(false);
    expect(viewer).not.toContain("<button");
    expect(viewer).not.toContain('type="radio"');
    expect(viewer).toContain("§products.categories.primaryMark");
  });
});

describe("the editor with the real uk and en messages", () => {
  it("renders every piece without a missing key", async () => {
    const sentinel = t;
    try {
      for (const locale of ["uk", "en"] as const) {
        t = createTranslator(await messagesForArea(locale, MESSAGE_FILES), locale);
        for (const canWrite of [true, false]) {
          for (const mode of ["draft", "publish"] as const) {
            expect(attributesForm(canWrite, mode)).toContain("<form");
          }
        }
        expect(
          renderInRouter(
            <LifecycleActionsView
              t={t}
              actions={[...LIFECYCLE_ACTIONS]}
              busy={null}
              locked
              onAction={noop}
            />,
          ),
        ).toContain("<button");
        for (const kind of EDITOR_NOTICE_KINDS) {
          const values = { created: 2, skipped: 1, sku: "SKU-1" };
          expect(
            renderInRouter(<EditorNoticeBar t={t} notice={{ kind, n: 1, values }} />),
          ).toContain("<p");
        }
        for (const tab of ["prices", "stock"] as const) {
          expect(renderInRouter(<ComingTabView t={t} tab={tab} />)).toContain("<p");
        }
        const summary = renderInRouter(
          <ProductSummaryView
            t={t}
            uiLocale={locale}
            content={content}
            product={product({ status: "active", publishedAt: "2026-10-20T00:00:00.000Z" })}
            productType={productType}
            actions={null}
          />,
        );
        expect(summary).toContain("<h1");
      }
    } finally {
      t = sentinel;
    }
  });

  it("leaves no untranslated word in the sentinel rendering of the read-only form", () => {
    const html = attributesForm(false);
    const data = [
      ...specs.flatMap((spec) => [spec.code, `${spec.code}-name-en`]),
      "one-label-en",
      "two-label-en",
      "x-label-en",
      "y-label-en",
    ];
    let text = html;
    // Longest first, so a code never leaves the rest of a name behind.
    for (const value of [...data].sort((left, right) => right.length - left.length)) {
      text = text.split(value).join(" ");
    }
    expect(leftoverText(text)).toBe("");
  });
});
