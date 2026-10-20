import type {
  AdminAttributeWithOptions,
  AdminOptionWithValues,
  AdminProduct,
  AdminProductTypeAttribute,
  AdminProductTypeDetail,
  AdminVariant,
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
import { attributeFieldSpecs, attributeFormFrom } from "./attribute-values-form";
import { MESSAGE_FILES } from "./index";
import { mediaRowsFrom, newMediaRow, type MediaRow } from "./media-list";
import {
  planOptionChange,
  selectionFrom,
  selectionOrder,
  setValueChosen,
} from "./option-selection";
import { mapPublishProblems } from "./publish-problems";
import { MediaListView } from "./tabs/media-tab";
import { CurrentOptionsView, ReplaceOptionsView } from "./tabs/options-tab";
import {
  VariantCreateView,
  VariantEditorView,
  VariantsTableView,
  type VariantRowActions,
} from "./tabs/variants-tab";
import { newVariantValues, variantFormFrom } from "./variant-form";

let t: Translator = sentinelTranslator();
const noop = () => undefined;
const content = { defaultLocale: "uk", locales: ["uk", "en"] };
const stamp = "2026-10-20T10:00:00.000Z";

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
    createdAt: stamp,
    updatedAt: stamp,
    options: [],
    ...overrides,
  };
}

function assign(
  definition: AdminAttributeWithOptions,
  level: "product" | "variant",
  isRequired = false,
): AdminProductTypeAttribute {
  return {
    productTypeId: "type",
    attributeId: definition.id,
    attributeCode: definition.code,
    level,
    isRequired,
    position: 0,
    createdAt: stamp,
    attribute: definition,
  };
}

const productType: AdminProductTypeDetail = {
  id: "type",
  code: "sample_type",
  name: { uk: "Тип", en: "Sample type" },
  requiresShipping: true,
  createdAt: stamp,
  updatedAt: stamp,
  options: [
    {
      productTypeId: "type",
      optionId: "opt-a",
      optionCode: "axis_a",
      position: 0,
      createdAt: stamp,
    },
    {
      productTypeId: "type",
      optionId: "opt-b",
      optionCode: "axis_b",
      position: 1,
      createdAt: stamp,
    },
  ],
  attributes: [
    assign(attribute("only_on_product", "text"), "product", true),
    assign(attribute("per_variant", "number", { unit: "mm" }), "variant", true),
    assign(attribute("variant_note", "text", { isLocalized: true }), "variant"),
  ],
};

const definitions: ReadonlyMap<string, AdminOptionWithValues> = new Map([
  [
    "opt-a",
    {
      id: "opt-a",
      code: "axis_a",
      name: { uk: "Вісь А", en: "Axis A" },
      createdAt: stamp,
      updatedAt: stamp,
      values: [
        {
          id: "a1",
          optionId: "opt-a",
          code: "a_one",
          label: { uk: "А1", en: "A one" },
          position: 0,
          createdAt: stamp,
          updatedAt: stamp,
        },
        {
          id: "a2",
          optionId: "opt-a",
          code: "a_two",
          label: { uk: "А2", en: "A two" },
          position: 1,
          createdAt: stamp,
          updatedAt: stamp,
        },
      ],
    },
  ],
  [
    "opt-b",
    {
      id: "opt-b",
      code: "axis_b",
      name: { uk: "Вісь Б", en: "Axis B" },
      createdAt: stamp,
      updatedAt: stamp,
      values: [
        {
          id: "b1",
          optionId: "opt-b",
          code: "b_one",
          label: { uk: "Б1", en: "B one" },
          position: 0,
          createdAt: stamp,
          updatedAt: stamp,
        },
      ],
    },
  ],
]);

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
    optionValues: [
      {
        optionId: "opt-a",
        optionCode: "axis_a",
        optionValueId: id === "v1" ? "a1" : "a2",
        valueCode: "x",
      },
    ],
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

function product(overrides: Partial<AdminProduct> = {}): AdminProduct {
  return {
    id: "p1",
    productTypeId: "type",
    brandId: null,
    slug: "first-product",
    title: { uk: "Перший", en: "First" },
    description: null,
    status: "draft",
    attributes: {},
    publishedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
    categories: [],
    media: [
      {
        id: "m1",
        url: "https://img.example/one.jpg",
        alt: { uk: "Перше фото", en: "First photo" },
        position: 0,
        optionId: null,
        optionValueId: null,
        createdAt: stamp,
        updatedAt: stamp,
      },
      {
        id: "m2",
        url: "javascript:alert(1)",
        alt: null,
        position: 1,
        optionId: "opt-a",
        optionValueId: "a1",
        createdAt: stamp,
        updatedAt: stamp,
      },
    ],
    options: [
      {
        optionId: "opt-a",
        optionCode: "axis_a",
        position: 0,
        values: [
          { optionValueId: "a1", valueCode: "a_one", position: 0 },
          { optionValueId: "a2", valueCode: "a_two", position: 1 },
        ],
      },
    ],
    variants: [
      variant("v1", { isDefault: true, attributes: { per_variant: 12 } }),
      variant("v2", { isActive: false, barcode: "4006381333931" }),
    ],
    ...overrides,
  };
}

const naming = { uiLocale: "en", content, byId: definitions };
const variantNaming = { uiLocale: "en", content, options: definitions };
const links = [
  { optionId: "opt-a", optionValueId: "a1", label: "Axis A: A one" },
  { optionId: "opt-a", optionValueId: "a2", label: "Axis A: A two" },
];

function media(
  canWrite: boolean,
  rows: readonly MediaRow[] = mediaRowsFrom(product().media, content.locales),
) {
  return renderInRouter(
    <MediaListView
      t={t}
      uiLocale="en"
      content={content}
      rows={rows}
      onChange={noop}
      onAdd={noop}
      links={links}
      issues={{}}
      summary={[]}
      problems={[]}
      busy={false}
      canWrite={canWrite}
      onSubmit={noop}
    />,
  );
}

const tag = (html: string, id: string) =>
  new RegExp(`<(?:input|select|textarea|button|span|li)\\b[^>]*\\bid="${id}"[^>]*>`).exec(
    html,
  )?.[0] ?? "";

describe("Media tab", () => {
  it("lists every image with its fields, a lazy no-referrer preview with explicit size and the data's alt", () => {
    const html = media(true);
    expect(html).toMatch(/<form\b[^>]*method="post"/);
    expect(html).not.toMatch(/<form\b[^>]*action=/);
    expect(tag(html, "product-media-0-url")).toContain('type="url"');
    expect(tag(html, "product-media-0-alt-uk")).not.toBe("");
    expect(tag(html, "product-media-1-link")).toMatch(/^<select/);
    const images = [...html.matchAll(/<img\b[^>]*>/g)].map((match) => match[0]);
    expect(images).toHaveLength(1);
    expect(images[0]).toContain('src="https://img.example/one.jpg"');
    expect(images[0]).toContain('loading="lazy"');
    expect(images[0]).toContain('referrerPolicy="no-referrer"');
    expect(images[0]).toContain('width="96"');
    expect(images[0]).toContain('height="96"');
    expect(images[0]).toContain('alt="First photo"');
    expect(html).not.toContain('src="javascript');
    expect(html).toContain("§products.media.policy");
  });

  it("offers move up and down as buttons (first cannot go up, last cannot go down), remove and add", () => {
    const html = media(true);
    const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);
    const byLabel = (label: string) => buttons.filter((button) => button.includes(label));
    expect(byLabel("§products.media.moveUpLabel")).toHaveLength(2);
    expect(byLabel("§products.media.moveUpLabel")[0]).toContain('disabled=""');
    expect(byLabel("§products.media.moveUpLabel")[1]).not.toContain('disabled=""');
    expect(byLabel("§products.media.moveDownLabel")[1]).toContain('disabled=""');
    expect(byLabel("§products.media.removeLabel")).toHaveLength(2);
    expect(html).toContain("§products.media.add");
    expect(html).toContain("§products.media.save");
  });

  it("offers the product's chosen values as links, and keeps a stored link the product no longer has", () => {
    const html = media(true);
    expect(html).toContain("Axis A: A one");
    expect(html).toContain("§products.media.noLink");
    const stale: MediaRow[] = [
      {
        ...newMediaRow("x", content.locales),
        url: "https://img.example/x.jpg",
        optionId: "opt-z",
        optionValueId: "z9",
      },
    ];
    expect(media(true, stale)).toContain("§products.media.unknownLink");
  });

  it("is read-only for a viewer: no button, inputs read-only, the link disabled", () => {
    const html = media(false);
    expect(html).not.toContain("<button");
    expect(tag(html, "product-media-0-url")).toContain('readOnly=""');
    expect(tag(html, "product-media-0-link")).toContain('disabled=""');
  });

  it("shows an empty list and no add button at 100 images", () => {
    expect(media(true, [])).toContain("§products.media.none");
    const full = Array.from({ length: 100 }, (_, index) => ({
      ...newMediaRow(`n${index}`, content.locales),
      url: "https://img.example/x.jpg",
    }));
    const html = media(true, full);
    expect(html).not.toContain("§products.media.add<");
    expect(html).toContain("§products.media.full");
  });
});

describe("Options tab", () => {
  it("lists the product's options with their values, each option a focus target with its publish problems", () => {
    const problems = mapPublishProblems(
      {
        type: "about:blank",
        title: "x",
        status: 400,
        code: "validation_failed",
        detail: "x",
        errors: [{ path: "options.axis_a", code: "option_not_allowed" }],
      },
      { defaultLocale: "uk", variants: product().variants },
    );
    const html = renderInRouter(
      <CurrentOptionsView
        t={t}
        naming={naming}
        product={product()}
        problems={problems}
        busy={false}
      />,
    );
    expect(tag(html, "product-option-axis_a")).toContain('tabindex="-1"');
    expect(html).toContain("A one, A two");
    expect(html).toContain("§errors.reason.option_not_allowed");
    expect(html).not.toContain("<select");
  });

  it("offers a live product's admin the values still addable to an option", () => {
    const html = renderInRouter(
      <CurrentOptionsView
        t={t}
        naming={naming}
        product={product({ status: "active" })}
        problems={[]}
        busy={false}
        addValue={() => ({
          choices: [{ id: "a3", label: "A three" }],
          chosen: "",
          onChoose: noop,
          onAdd: noop,
        })}
      />,
    );
    expect(html).toContain("A three");
    expect(html).toContain("§products.options.addValue");
  });

  it("the draft's replace form has a checkbox per allowed option and value, and warns when variants are rebuilt", () => {
    const current = selectionFrom(product().options);
    const order = selectionOrder(product().options, [
      { optionId: "opt-a", valueIds: ["a1", "a2"] },
      { optionId: "opt-b", valueIds: ["b1"] },
    ]);
    const render = (selection: typeof current) =>
      renderInRouter(
        <ReplaceOptionsView
          t={t}
          naming={naming}
          productType={productType}
          order={order}
          selection={selection}
          onChange={noop}
          issues={{}}
          summary={[]}
          plan={planOptionChange(current, selection)}
          variantsNow={2}
          busy={false}
          onSubmit={noop}
        />,
      );
    const unchanged = render(current);
    expect(unchanged).toMatch(/<form\b[^>]*method="post"/);
    expect(unchanged.match(/type="checkbox"/g)).toHaveLength(5);
    expect(unchanged).toContain("§products.options.planNone");
    expect(render(setValueChosen(current, "opt-a", "a2", false))).toContain(
      "§products.options.planRebuild",
    );
    expect(render(setValueChosen(current, "opt-b", "b1", true))).toContain(
      "§products.options.planRebuild",
    );
  });
});

const allActions: VariantRowActions = {
  canEdit: true,
  canDelete: true,
  busy: false,
  onEdit: noop,
  onMakeDefault: noop,
  onToggleActive: noop,
  onDelete: noop,
};
const variantSpecs = attributeFieldSpecs(productType, "variant");

function table(
  actions: VariantRowActions,
  overrides: Partial<AdminProduct> = {},
  problems = [] as ReturnType<typeof mapPublishProblems>,
) {
  return renderInRouter(
    <VariantsTableView
      t={t}
      naming={variantNaming}
      product={product(overrides)}
      specs={variantSpecs}
      problems={problems}
      actions={actions}
    />,
  );
}

describe("Variants tab", () => {
  it("lists the variants with SKU as the focusable row header, values, status as text and variant attributes only", () => {
    const html = table(allActions);
    expect(html).toContain('id="product-variant-v1"');
    expect(html).toMatch(/<th scope="row"[^>]*>.*?id="product-variant-v1"/s);
    expect(html).toContain("A one");
    expect(html).toContain("§products.variants.active");
    expect(html).toContain("§products.variants.inactive");
    expect(html).toContain("§products.variants.default");
    expect(html).toContain("§products.variants.attributeValue");
    expect(html).toContain("§products.variants.attributeMissing");
    expect(html).not.toContain("only_on_product");
    expect(html).toContain("4006381333931");
  });

  it("puts a variants.N publish problem on that variant's row and nowhere else", () => {
    const problems = mapPublishProblems(
      {
        type: "about:blank",
        title: "x",
        status: 400,
        code: "validation_failed",
        detail: "x",
        errors: [{ path: "variants.1", code: "price_missing" }],
      },
      { defaultLocale: "uk", variants: product().variants },
    );
    const html = table(allActions, {}, problems);
    const rows = html.split("<tr").slice(2);
    expect(rows).toHaveLength(2);
    expect(rows[0]).not.toContain("§errors.reason.price_missing");
    expect(rows[1]).toContain("§errors.reason.price_missing");
  });

  it("offers on a draft: edit, make default and switch for each, delete only where the API allows it", () => {
    const html = table(allActions);
    expect(html.match(/§products\.variants\.editLabel/g)).toHaveLength(2);
    expect(html.match(/§products\.variants\.makeDefaultLabel/g)).toHaveLength(1);
    expect(html.match(/§products\.variants\.deleteLabel/g)).toHaveLength(1);
    expect(html).toContain("§products.variants.hint.default_variant");
    expect(html).toContain("§products.variants.activateLabel");
    expect(html).toContain("§products.variants.deactivateLabel");
  });

  it("explains on a live product why variants are not deleted and the default stays on", () => {
    const html = table(allActions, { status: "active" });
    expect(html).not.toContain("§products.variants.deleteLabel");
    expect(html).toContain("§products.variants.hint.product_not_draft");
    expect(html).toContain("§products.variants.hint.default_variant_inactive");
    expect(html).toContain("§products.variants.hint.defaultNeedsActive");
  });

  it("has no action at all for a viewer", () => {
    const html = table({ ...allActions, canEdit: false, canDelete: false });
    expect(html).not.toContain("<button");
    expect(html).not.toContain("§products.variants.columnActions");
  });

  it("the edit form: SKU, barcode, flags and the variant-level attributes (never product-level), posted", () => {
    const stored = product().variants[0] as AdminVariant;
    const html = renderInRouter(
      <VariantEditorView
        t={t}
        uiLocale="en"
        content={content}
        variant={stored}
        values={{ ...variantFormFrom(stored), sku: "sku-v1 " }}
        onChange={noop}
        specs={variantSpecs}
        attributes={attributeFormFrom(variantSpecs, stored.attributes, content.locales)}
        onAttributesChange={noop}
        mode="draft"
        issues={{ "attributes.per_variant": { key: "products.attributeReason.required" } }}
        summary={[]}
        busy={false}
        onSubmit={noop}
        onCancel={noop}
      />,
    );
    expect(html).toMatch(/<form\b[^>]*method="post"/);
    expect(tag(html, "variant-sku")).not.toBe("");
    expect(html).toContain("§products.variants.skuNormalized");
    expect(tag(html, "variant-attribute-per_variant")).toContain('aria-invalid="true"');
    expect(tag(html, "variant-attribute-variant_note-uk")).not.toBe("");
    expect(html).not.toContain("only_on_product");
    expect(html).not.toContain('id="product-attribute-');
  });

  it("the create form asks one value per option", () => {
    const html = renderInRouter(
      <VariantCreateView
        t={t}
        naming={variantNaming}
        product={product()}
        values={newVariantValues(product(), true)}
        onChange={noop}
        issues={{ optionValueIds: { key: "products.variants.combinationTaken" } }}
        summary={[]}
        busy={false}
        onSubmit={noop}
        onCancel={noop}
      />,
    );
    expect(html).toMatch(/<form\b[^>]*method="post"/);
    expect(tag(html, "variant-new-axis_a")).toMatch(/^<select/);
    expect(html).toContain("A two");
    expect(html).toContain("§products.variants.combinationTaken");
  });
});

describe("the new tabs with the real uk and en messages", () => {
  it("render every piece without a missing key", async () => {
    const sentinel = t;
    try {
      for (const locale of ["uk", "en"] as const) {
        t = createTranslator(await messagesForArea(locale, MESSAGE_FILES), locale);
        for (const canWrite of [true, false]) expect(media(canWrite)).toContain("<form");
        expect(media(true, [])).toContain("<form");
        for (const status of ["draft", "active"] as const) {
          expect(table(allActions, { status })).toContain("<table");
          expect(
            table(allActions, { status, variants: [variant("solo", { isDefault: true })] }),
          ).toContain("<table");
        }
        const current = selectionFrom(product().options);
        expect(
          renderInRouter(
            <ReplaceOptionsView
              t={t}
              naming={naming}
              productType={productType}
              order={selectionOrder(product().options, [])}
              selection={current}
              onChange={noop}
              issues={{ options: { key: "products.optionReason.too_many_variants_total" } }}
              summary={[]}
              plan={planOptionChange(current, setValueChosen(current, "opt-a", "a1", false))}
              variantsNow={2}
              busy={false}
              onSubmit={noop}
            />,
          ),
        ).toContain("<form");
      }
    } finally {
      t = sentinel;
    }
  });

  it("leave no untranslated word in the sentinel rendering of the media list and the variant table", () => {
    const data = [
      "https://img.example/one.jpg",
      "javascript:alert(1)",
      "First photo",
      "Перше фото",
      "Axis A: A one",
      "Axis A: A two",
      "SKU-V1",
      "SKU-V2",
      "A one",
      "A two",
      "4006381333931",
      "per_variant-name-en",
      "variant_note-name-en",
      "mm",
    ];
    let text = media(true) + table(allActions);
    for (const value of [...data].sort((left, right) => right.length - left.length)) {
      text = text.split(value).join(" ");
    }
    expect(leftoverText(text)).toBe("");
  });
});
