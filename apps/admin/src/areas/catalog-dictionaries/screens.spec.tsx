import {
  ADMIN_OPERATIONS,
  type AdminAttributeOption,
  AdminProductTypeAttribute,
  AdminProductTypeOptionAssignment,
  AdminCategory,
} from "@fluxkit/api-client";
import { ROLE_PERMISSIONS } from "@fluxkit/core";
import { createTranslator, type DataTableColumn, type Translator } from "@fluxkit/ui";
import { describe, expect, it } from "vitest";
import {
  leftoverText,
  messagesForArea,
  renderInRouter,
  sentinelTranslator,
  textAttributes,
} from "../../test-helpers";
import { AttributeFormView } from "./attribute-form-view";
import {
  applyFlag,
  changeInputType,
  emptyAttributeForm,
  type AttributeFormValues,
} from "./attribute-form";
import { BrandFormView, BrandLogoPreview } from "./brand-form-view";
import { CategoryFormView } from "./category-form-view";
import { MAX_CATEGORY_DEPTH, type TreeItem } from "./category-tree";
import { CategoryTreeView } from "./category-tree-view";
import { CodeNameFormView } from "./code-name-form-view";
import { ConfigGateView } from "./config-gate";
import { emptyBrandForm, emptyCategoryForm, emptyOptionForm } from "./dictionary-forms";
import { DictionaryNav, NoticeBar } from "./dictionary-frame";
import { MESSAGE_FILES } from "./index";
import { DICTIONARY_WRITE_OPERATIONS, canWriteDictionaries } from "./dictionary-permissions";
import { ConfirmDelete, FormDialog } from "./form-dialog";
import { ItemsSection } from "./items-section";
import { ListScreen, type ListState } from "./list-screen";
import { initialPickerState, type PickerState } from "./picker-model";
import { AttributeAssignmentsSection, OptionAssignmentsSection } from "./product-type-assignments";
import { ServerPickerView } from "./server-picker";

let t: Translator = sentinelTranslator();
const noop = () => undefined;
const content = { defaultLocale: "uk", locales: ["uk", "en"] };

/** Visible text left after the sentinels and the given data strings (codes, names) are removed. */
function leftover(html: string, data: string[] = []): string {
  let text = html;
  for (const value of data) text = text.split(value).join(" ");
  return leftoverText(text);
}

function expectTranslated(html: string, data: string[] = []) {
  expect(leftover(html, data)).toBe("");
  for (const value of textAttributes(html)) {
    if (data.some((entry) => value.includes(entry))) continue;
    expect(value.startsWith("§"), value).toBe(true);
  }
}

/** The whole opening tag of the control with the given attribute, so a test does not depend on the attribute order. */
function tagOf(html: string, attribute: "id" | "name", value: string): string {
  const match = new RegExp(
    `<(?:input|select|textarea)\\b[^>]*\\b${attribute}="${value}"[^>]*>`,
  ).exec(html);
  expect(match, `no control with ${attribute}="${value}"`).not.toBeNull();
  return match?.[0] ?? "";
}

const h1s = (html: string) => html.match(/<h1[ >]/g)?.length ?? 0;
const hasButtonLabelled = (html: string, key: string) =>
  new RegExp(`<button[^>]*>\\s*(<[^>]*>)*§${key.replace(/\./g, "\\.")}`).test(html);

// ------------------------------------------------------------------ permissions

describe("write permission of the dictionary screens", () => {
  it("is given by the permission list of the session, not by a role name", () => {
    expect(canWriteDictionaries([...ROLE_PERMISSIONS.owner])).toBe(true);
    expect(canWriteDictionaries([...ROLE_PERMISSIONS.manager])).toBe(true);
    expect(canWriteDictionaries([...ROLE_PERMISSIONS.viewer])).toBe(false);
    expect(canWriteDictionaries(["catalog.read"])).toBe(false);
    expect(canWriteDictionaries(["catalog.write"])).toBe(true);
    expect(canWriteDictionaries(null)).toBe(false);
    expect(canWriteDictionaries([])).toBe(false);
  });

  it("names only operations that need catalog.write, and every dictionary write operation (hand-written expectation)", () => {
    for (const operation of DICTIONARY_WRITE_OPERATIONS) {
      expect(ADMIN_OPERATIONS[operation].permission, operation).toBe("catalog.write");
    }
    expect(DICTIONARY_WRITE_OPERATIONS.length).toBe(26);
    const dictionaryWrites = Object.entries(ADMIN_OPERATIONS)
      .filter(
        ([name, spec]) =>
          spec.permission === "catalog.write" &&
          /Attribute|Option|ProductType|Brand|Category/.test(name) &&
          !/Product(?!Type)/.test(name.replace("ProductType", "")),
      )
      .map(([name]) => name)
      .sort();
    expect([...DICTIONARY_WRITE_OPERATIONS].sort()).toEqual(dictionaryWrites);
  });
});

// ----------------------------------------------------------------------- navigation

describe("sub-navigation", () => {
  it("links the five dictionaries and marks the current one", () => {
    const html = renderInRouter(<DictionaryNav t={t} current="brands" />);
    for (const path of ["attributes", "options", "product-types", "brands", "categories"]) {
      expect(html).toContain(`href="/admin-ui/catalog/${path}"`);
    }
    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
    expect(html).toMatch(/aria-current="page"[^>]*>§page\.brands\.title/);
    expect(html).toContain('aria-label="§dict.nav.label"');
    expectTranslated(html);
  });
});

describe("status line", () => {
  it("is always in the page as a live region, empty until there is a notice", () => {
    const empty = renderInRouter(<NoticeBar t={t} notice={null} />);
    expect(empty).toContain('role="status"');
    expect(empty).toContain('tabindex="-1"');
    const saved = renderInRouter(<NoticeBar t={t} notice={{ kind: "saved", n: 1 }} />);
    expect(saved).toContain("§dict.notice.saved");
  });

  it("says the result is unknown for a lost answer, as a warning and not as a success", () => {
    const html = renderInRouter(<NoticeBar t={t} notice={{ kind: "unknown", n: 1 }} />);
    expect(html).toContain("§dict.unknown.title");
    expect(html).toContain("§dict.unknown.body");
    expect(html).not.toContain("§dict.notice.saved");
  });
});

// ------------------------------------------------------------------------- lists

interface Row {
  id: string;
  code: string;
}
const columns: DataTableColumn<Row>[] = [{ id: "code", header: "§col", cell: (row) => row.code }];
const rows: Row[] = [
  { id: "1", code: "alpha" },
  { id: "2", code: "beta" },
];

function list(
  state: ListState<Row>,
  canWrite: boolean,
  extra: { offset?: number; total?: number } = {},
) {
  return renderInRouter(
    <ListScreen<Row>
      t={t}
      current="attributes"
      title="§title"
      state={state}
      onRetry={noop}
      canWrite={canWrite}
      createTo="/catalog/attributes/new"
      createLabel="§create"
      caption="§caption"
      columns={columns}
      rowKey={(row) => row.id}
      emptyTitle="§emptyTitle"
      emptyBody="§emptyBody"
      limit={2}
      offset={extra.offset ?? 0}
      hrefForOffset={(offset) => `/catalog/attributes?offset=${offset}`}
    />,
  );
}

const ready = (items: Row[], total = items.length): ListState<Row> => ({
  status: "ready",
  data: { items, total, limit: 2, offset: 0 },
});

describe("list screen", () => {
  it("shows skeleton rows while loading, as a busy table", () => {
    const html = list({ status: "loading" }, true);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("animate-pulse");
    expect(html).toContain("§status.loading");
    expect(h1s(html)).toBe(1);
    expectTranslated(html);
  });

  it("shows the rows with the first column as the row header, a create link for a writer", () => {
    const html = list(ready(rows), true);
    expect(html).toContain('<th scope="row"');
    expect(html).toContain("alpha");
    expect(html).toContain('href="/admin-ui/catalog/attributes/new"');
    expect(html).toContain("§create");
    expect(h1s(html)).toBe(1);
    expectTranslated(html, ["alpha", "beta"]);
  });

  it("has no create link for a viewer, in the table or in the empty state", () => {
    expect(list(ready(rows), false)).not.toContain("§create");
    const empty = list(ready([]), false);
    expect(empty).not.toContain("§create");
    expect(empty).not.toContain("/catalog/attributes/new");
  });

  it("shows the empty state with the create action for a writer only", () => {
    const html = list(ready([]), true);
    expect(html).toContain("§emptyTitle");
    expect(html).toContain("§emptyBody");
    expect(html.match(/§create/g)?.length).toBe(2);
    expectTranslated(html);
  });

  it("shows a failure with a retry button, and forbidden and not found as messages", () => {
    const failure = list({ status: "error", failure: { kind: "network" } }, true);
    expect(failure).toContain('role="alert"');
    expect(failure).toContain("§errors.network");
    expect(failure).toContain("§action.retry");
    expect(list({ status: "forbidden" }, true)).toContain("§error.forbiddenData");
    expect(list({ status: "notFound" }, true)).toContain("§error.notFoundData");
  });

  it("pages with links: next when more rows exist, previous after the first page, the range spelled out", () => {
    const first = list(ready(rows, 5), false);
    expect(first).toContain("§dict.list.range");
    expect(first).toContain('href="/admin-ui/catalog/attributes?offset=2"');
    expect(first).toContain('rel="next"');
    expect(first).not.toContain('rel="prev"');
    const second = list(ready(rows, 5), false, { offset: 2 });
    expect(second).toContain('rel="prev"');
    expect(second).toContain('href="/admin-ui/catalog/attributes?offset=0"');
  });

  it("says so when the page is past the end, with a way back", () => {
    const html = list(ready([], 3), true, { offset: 10 });
    expect(html).toContain("§dict.list.pastEnd");
    expect(html).toContain("§dict.list.firstPage");
    expect(html).not.toContain("§emptyTitle");
  });
});

// ---------------------------------------------------------------- attribute form

function attributeForm(
  values: AttributeFormValues,
  options: { mode?: "create" | "edit"; canWrite?: boolean; busy?: boolean; summary?: boolean } = {},
) {
  return renderInRouter(
    <AttributeFormView
      t={t}
      uiLocale="en"
      content={content}
      mode={options.mode ?? "create"}
      idPrefix="attribute"
      values={values}
      onChange={noop}
      issues={options.summary ? { "name.uk": { key: "errors.reason.default_locale_missing" } } : {}}
      summary={options.summary ? [{ key: "dict.form.checkFields" }] : []}
      busy={options.busy ?? false}
      canWrite={options.canWrite ?? true}
      onSubmit={noop}
      cancelTo="/catalog/attributes"
    />,
  );
}

describe("attribute form", () => {
  const base = emptyAttributeForm(content.locales);

  it("is a post form without an action, with one labelled field per content locale and the default one required", () => {
    const html = attributeForm(base);
    expect(html).toMatch(/<form [^>]*method="post"/);
    expect(html).not.toMatch(/<form[^>]*action=/);
    expect(tagOf(html, "id", "attribute-name-uk")).toMatch(/\brequired=""/);
    expect(tagOf(html, "id", "attribute-name-en")).not.toMatch(/\brequired=""/);
    expect(html).toContain('lang="uk"');
    expect(html).toContain('lang="en"');
    expect(tagOf(html, "id", "attribute-code")).toMatch(/\brequired=""/);
    expectTranslated(html);
  });

  it("offers the six flags by the API's names", () => {
    const html = attributeForm(changeInputType(base, "number"));
    for (const flag of [
      "isFilterable",
      "isSearchable",
      "isVisibleOnStorefront",
      "isComparable",
      "isSortable",
      "isInternal",
    ]) {
      expect(html, flag).toContain(`name="${flag}"`);
    }
  });

  it("shows the validation fields of the chosen type and the unit for numbers only", () => {
    const keys = (html: string) =>
      [...html.matchAll(/name="validation\.([a-z_]+)"/g)].map((match) => match[1]);
    expect(keys(attributeForm(base))).toEqual(["min_length", "max_length"]);
    const number = attributeForm(changeInputType(base, "number"));
    expect(keys(number)).toEqual(["min", "max", "integer", "max_decimals"]);
    expect(number).toContain('name="unit"');
    expect(attributeForm(base)).not.toContain('name="unit"');
    expect(keys(attributeForm(changeInputType(base, "multiselect")))).toEqual([
      "min_items",
      "max_items",
    ]);
    expect(keys(attributeForm(changeInputType(base, "date")))).toEqual(["min", "max"]);
    expect(keys(attributeForm(changeInputType(base, "boolean")))).toEqual([]);
    expect(attributeForm(changeInputType(base, "select"))).not.toContain(
      "§dict.attribute.validation<",
    );
  });

  it("disables the flags the type cannot have and, for an internal attribute, every public flag", () => {
    const text = attributeForm(base);
    expect(tagOf(text, "name", "isFilterable")).toMatch(/\bdisabled=""/);
    expect(tagOf(text, "name", "isSortable")).toMatch(/\bdisabled=""/);
    expect(tagOf(text, "name", "isSearchable")).not.toMatch(/\bdisabled=""/);
    const internal = attributeForm(applyFlag(base, "isInternal", true));
    expect(tagOf(internal, "name", "isSearchable")).toMatch(/\bdisabled=""/);
    expect(tagOf(internal, "name", "isVisibleOnStorefront")).toMatch(/\bdisabled=""/);
    expect(tagOf(internal, "name", "isInternal")).not.toMatch(/\bdisabled=""/);
  });

  it("lets the code and the type be chosen on create and shows them fixed on edit", () => {
    const create = attributeForm(base);
    expect(tagOf(create, "id", "attribute-code")).not.toMatch(/\breadOnly=""/);
    expect(tagOf(create, "name", "inputType")).not.toMatch(/\bdisabled=""/);
    const edit = attributeForm({ ...base, code: "length" }, { mode: "edit" });
    expect(tagOf(edit, "id", "attribute-code")).toMatch(/\breadOnly=""/);
    expect(tagOf(edit, "name", "inputType")).toMatch(/\bdisabled=""/);
    expect(tagOf(edit, "name", "isLocalized")).toMatch(/\bdisabled=""/);
    expect(edit).toContain("§dict.attribute.inputTypeFixed");
  });

  it("is read-only for a viewer: no actions, readonly inputs, disabled checkboxes", () => {
    const html = attributeForm({ ...base, code: "length" }, { mode: "edit", canWrite: false });
    expect(html).not.toContain('type="submit"');
    expect(html).not.toContain("§dict.form.save");
    expect(html).not.toContain("§dict.form.backToList");
    expect(tagOf(html, "id", "attribute-name-uk")).toMatch(/\breadOnly=""/);
    expect(tagOf(html, "id", "attribute-description-uk")).toMatch(/\breadOnly=""/);
    expect(tagOf(html, "name", "isSearchable")).toMatch(/\bdisabled=""/);
    expect(tagOf(html, "name", "isInternal")).toMatch(/\bdisabled=""/);
  });

  it("shows save and cancel for a writer, and a busy state that disables saving", () => {
    const idle = attributeForm(base);
    expect(idle).toContain('type="submit"');
    expect(idle).toContain("§dict.attribute.create");
    const busy = attributeForm(base, { busy: true });
    expect(busy).toMatch(
      /<button[^>]*disabled[^>]*type="submit"|<button[^>]*type="submit"[^>]*disabled/,
    );
    expect(busy).toContain("§dict.form.saving");
  });

  it("shows the error summary as a focusable alert and the field error on its field", () => {
    const html = attributeForm(base, { summary: true });
    expect(html).toMatch(/<div tabindex="-1"><div role="alert"/);
    expect(html).toContain("§dict.form.checkFields");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("§errors.reason.default_locale_missing");
  });
});

// ------------------------------------------------------------ other form views

describe("option and product type form", () => {
  const view = (canWrite: boolean, mode: "create" | "edit") =>
    renderInRouter(
      <CodeNameFormView
        t={t}
        uiLocale="en"
        content={content}
        prefix="productType"
        mode={mode}
        idPrefix="productType"
        values={{ ...emptyOptionForm(content.locales), code: "book" }}
        onChange={noop}
        issues={{}}
        summary={[]}
        busy={false}
        canWrite={canWrite}
        onSubmit={noop}
        cancelTo="/catalog/product-types"
        extra={<span>§extra</span>}
      />,
    );

  it("lets a writer create, with a pattern for the code, and shows the extra fields", () => {
    const html = view(true, "create");
    expect(html).toContain('pattern="[a-z][a-z0-9_]{0,63}"');
    expect(html).toContain("§dict.productType.create");
    expect(html).toContain("§extra");
    expectTranslated(html, ["book"]);
  });

  it("is read-only for a viewer and fixes the code on edit", () => {
    const viewer = view(false, "edit");
    expect(viewer).not.toContain('type="submit"');
    expect(tagOf(viewer, "id", "productType-code")).toMatch(/\breadOnly=""/);
    expect(tagOf(viewer, "id", "productType-name-uk")).toMatch(/\breadOnly=""/);
    expect(tagOf(view(true, "edit"), "id", "productType-code")).toMatch(/\breadOnly=""/);
  });
});

describe("brand form", () => {
  const view = (logoUrl: string, canWrite = true, mode: "create" | "edit" = "create") =>
    renderInRouter(
      <BrandFormView
        t={t}
        uiLocale="en"
        content={content}
        mode={mode}
        idPrefix="brand"
        values={{ ...emptyBrandForm(content.locales), logoUrl, slug: "acme" }}
        onChange={noop}
        issues={{}}
        summary={[]}
        busy={false}
        canWrite={canWrite}
        onSubmit={noop}
        cancelTo="/catalog/brands"
        logoAlt="Logo of Acme"
      />,
    );

  it("previews an http(s) logo as a lazy image without referrer, with the alt text from props", () => {
    const html = view("https://example.com/acme.png");
    expect(html).toContain('src="https://example.com/acme.png"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain('alt="Logo of Acme"');
  });

  it("never renders an image for a URL that is not http(s)", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "//evil.example/a.png",
      "/relative.png",
      "ftp://example.com/a.png",
      "",
      " https://example.com/a.png",
    ]) {
      const html = renderInRouter(<BrandLogoPreview url={url} alt="x" failedText="failed" />);
      if (url === " https://example.com/a.png") {
        // surrounding blanks are trimmed by the form before the check
        expect(html).toContain("<img");
      } else {
        expect(html, url).not.toContain("<img");
      }
    }
  });

  it("uses a url input with the API's length limit and is read-only for a viewer", () => {
    const writer = view("");
    expect(writer).toContain('type="url"');
    expect(writer).toContain('maxLength="2048"');
    expect(writer).toContain("§dict.brand.create");
    const viewer = view("https://example.com/a.png", false, "edit");
    expect(viewer).not.toContain('type="submit"');
    expect(tagOf(viewer, "id", "brand-logoUrl")).toMatch(/\breadOnly=""/);
    expect(tagOf(viewer, "id", "brand-slug")).toMatch(/\breadOnly=""/);
    expectTranslated(viewer, ["acme", "example.com/a.png", "Logo of Acme"]);
  });
});

describe("category form", () => {
  const view = (canWrite: boolean, mode: "create" | "edit") =>
    renderInRouter(
      <CategoryFormView
        t={t}
        uiLocale="en"
        content={content}
        mode={mode}
        idPrefix="category"
        values={emptyCategoryForm(content.locales, null)}
        onChange={noop}
        issues={{}}
        summary={[]}
        busy={false}
        canWrite={canWrite}
        onSubmit={noop}
        cancelTo="/catalog/categories"
        parentLabel="Shoes"
      />,
    );

  it("shows the parent read-only (moving is its own action) and the active flag", () => {
    const html = view(true, "create");
    expect(tagOf(html, "id", "category-parent")).toMatch(/\breadOnly=""/);
    expect(html).toContain('name="isActive"');
    expect(html).not.toContain('name="parentId"');
    expect(html).not.toContain('name="position"');
    expectTranslated(html, ["Shoes"]);
  });

  it("is read-only for a viewer", () => {
    const html = view(false, "edit");
    expect(html).not.toContain('type="submit"');
    expect(tagOf(html, "name", "isActive")).toMatch(/\bdisabled=""/);
    expect(tagOf(html, "id", "category-slug")).toMatch(/\breadOnly=""/);
  });
});

// -------------------------------------------------------------- sections and rows

const attributeOptions: AdminAttributeOption[] = [
  {
    id: "o1",
    attributeId: "a1",
    code: "wool",
    label: { uk: "Вовна", en: "Wool" },
    position: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

function itemsSection(canWrite: boolean, items = attributeOptions) {
  return renderInRouter(
    <ItemsSection
      t={t}
      prefix="attributeOption"
      content={content}
      uiLocale="en"
      items={items}
      canWrite={canWrite}
      create={async () => ({ ok: true, status: 201, data: undefined })}
      update={async () => ({ ok: true, status: 200, data: undefined })}
      remove={async () => ({ ok: true, status: 204, data: undefined })}
      onChanged={noop}
    />,
  );
}

describe("items section (attribute options, option values)", () => {
  it("lists the rows by code, label and position with add, change and delete for a writer", () => {
    const html = itemsSection(true);
    expect(html).toContain("wool");
    expect(html).toContain("Wool");
    expect(hasButtonLabelled(html, "dict.attributeOption.add")).toBe(true);
    expect(html).toContain('aria-label="§dict.attributeOption.editLabel"');
    expect(html).toContain('aria-label="§dict.attributeOption.deleteLabel"');
    expect(html).not.toContain("<dialog");
    expectTranslated(html, ["wool", "Wool"]);
  });

  it("has no add, change or delete control for a viewer (the rows are still shown)", () => {
    const html = itemsSection(false);
    expect(html).toContain("wool");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("§dict.attributeOption.add");
    expect(html).not.toContain("§dict.form.edit");
    expect(html).not.toContain("§dict.form.delete");
  });

  it("says when there are no rows", () => {
    expect(itemsSection(false, [])).toContain("§dict.attributeOption.empty");
  });
});

const assignment: AdminProductTypeAttribute = {
  productTypeId: "t1",
  attributeId: "a1",
  attributeCode: "material",
  level: "variant",
  isRequired: true,
  position: 3,
  createdAt: "2026-01-01T00:00:00Z",
  attribute: {
    id: "a1",
    code: "material",
    name: { uk: "Матеріал", en: "Material" },
    description: null,
    inputType: "select",
    isLocalized: false,
    unit: null,
    validation: {},
    isFilterable: true,
    isSearchable: false,
    isVisibleOnStorefront: true,
    isComparable: false,
    isSortable: false,
    isInternal: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    options: [],
  },
};
const optionAssignment: AdminProductTypeOptionAssignment = {
  productTypeId: "t1",
  optionId: "o1",
  optionCode: "color",
  position: 1,
  createdAt: "2026-01-01T00:00:00Z",
};

describe("product type assignments", () => {
  const attributes = (canWrite: boolean) =>
    renderInRouter(
      <AttributeAssignmentsSection
        t={t}
        content={content}
        uiLocale="en"
        productTypeId="t1"
        canWrite={canWrite}
        rows={[assignment]}
        onChanged={noop}
      />,
    );
  const options = (canWrite: boolean) =>
    renderInRouter(
      <OptionAssignmentsSection
        t={t}
        content={content}
        uiLocale="en"
        productTypeId="t1"
        canWrite={canWrite}
        rows={[optionAssignment]}
        onChanged={noop}
      />,
    );

  it("shows level, required and position of each attribute, with links to the attribute", () => {
    const html = attributes(true);
    expect(html).toContain('href="/admin-ui/catalog/attributes/a1"');
    expect(html).toContain("§dict.level.variant");
    expect(html).toContain("§dict.form.yes");
    expect(hasButtonLabelled(html, "dict.assignment.attribute.add")).toBe(true);
    expectTranslated(html, ["material", "Material"]);
  });

  it("shows the allowed options with their position", () => {
    const html = options(true);
    expect(html).toContain('href="/admin-ui/catalog/options/o1"');
    expect(hasButtonLabelled(html, "dict.assignment.option.add")).toBe(true);
    expectTranslated(html, ["color"]);
  });

  it("has no assign, change or remove control for a viewer", () => {
    for (const html of [attributes(false), options(false)]) {
      expect(html).not.toContain("<button");
      expect(html).not.toContain("§dict.assignment.remove");
      expect(html).not.toContain("§dict.form.edit");
    }
    expect(attributes(false)).toContain("material");
  });
});

// ------------------------------------------------------------------------ picker

function picker(
  state: PickerState<{ id: string; name: string }>,
  extra: { disabledId?: string } = {},
) {
  return renderInRouter(
    <ServerPickerView
      t={t}
      id="picker"
      name="attributeId"
      label="§label"
      value=""
      onChange={noop}
      state={state}
      keyOf={(item) => item.id}
      labelOf={(item) => item.name}
      disabledReason={(item) => (item.id === extra.disabledId ? "taken" : null)}
      onLoadMore={noop}
      onRetry={noop}
    />,
  );
}

describe("server picker", () => {
  const items = [
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
  ];

  it("is disabled and busy while the first page loads", () => {
    const html = picker(initialPickerState);
    expect(html).toMatch(/<select[^>]*disabled/);
    expect(html).toContain('aria-busy="true"');
  });

  it("lists exactly the loaded page, marks an item that cannot be chosen instead of hiding it, and offers more", () => {
    const html = picker(
      { status: "ready", items, total: 250, loadingMore: false, moreFailed: false },
      { disabledId: "b" },
    );
    expect(html).toContain('<option value="a">Alpha</option>');
    expect(html).toContain('<option value="b" disabled="">Beta (taken)</option>');
    expect(html).toContain("§dict.picker.loaded");
    expect(hasButtonLabelled(html, "dict.picker.loadMore")).toBe(true);
  });

  it("offers no more button when everything is loaded", () => {
    const html = picker({
      status: "ready",
      items,
      total: 2,
      loadingMore: false,
      moreFailed: false,
    });
    expect(html).not.toContain("§dict.picker.loadMore");
  });

  it("shows a failed first page with a retry, and a failed further page with the loaded items kept", () => {
    const failed = picker({ ...initialPickerState, status: "error" });
    expect(failed).toContain("§dict.picker.failed");
    expect(failed).toContain("§action.retry");
    const more = picker({
      status: "ready",
      items,
      total: 250,
      loadingMore: false,
      moreFailed: true,
    });
    expect(more).toContain("§dict.picker.moreFailed");
    expect(more).toContain('<option value="a">Alpha</option>');
  });
});

// ------------------------------------------------------------------- config gate

describe("config gate", () => {
  const gate = (state: Parameters<typeof ConfigGateView>[0]["state"]) =>
    renderInRouter(
      <ConfigGateView t={t} state={state} onRetry={noop}>
        <p>§inside</p>
      </ConfigGateView>,
    );

  it("renders its children only when the config is known", () => {
    expect(gate({ status: "ready", data: content })).toContain("§inside");
    for (const state of [
      { status: "loading" },
      { status: "forbidden" },
      { status: "notFound" },
      { status: "error", failure: { kind: "timeout" } },
    ] as const) {
      expect(gate(state), state.status).not.toContain("§inside");
    }
    expect(gate({ status: "error", failure: { kind: "timeout" } })).toContain("§errors.timeout");
  });
});

// -------------------------------------------------------------------------- tree

function category(
  id: string,
  parentId: string | null,
  over: Partial<AdminCategory> = {},
): AdminCategory {
  return {
    id,
    parentId,
    slug: `slug-${id}`,
    name: { uk: `Name ${id}` },
    description: null,
    position: 0,
    isActive: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function item(over: Partial<TreeItem> & { id: string }): TreeItem {
  const { id, ...rest } = over;
  return {
    category: category(id, null),
    depth: 1,
    posInSet: 1,
    setSize: 1,
    expanded: false,
    canExpand: true,
    childStatus: "idle",
    hasMore: false,
    children: [],
    ...rest,
  };
}

function tree(items: TreeItem[], canWrite = true) {
  return renderInRouter(
    <CategoryTreeView
      t={t}
      uiLocale="en"
      content={content}
      items={items}
      canWrite={canWrite}
      onToggle={noop}
      onLoadMore={noop}
      onRetryChildren={noop}
    />,
  );
}

describe("category tree view", () => {
  it("is a labelled navigation with nested lists and an expand button per category", () => {
    const html = tree([item({ id: "a" }), item({ id: "b", posInSet: 2, setSize: 2 })]);
    expect(html).toContain('<nav aria-label="§dict.category.treeLabel">');
    expect(html.match(/aria-expanded="false"/g)?.length).toBe(2);
    expect(html).toContain('aria-label="§dict.category.subcategoriesOf"');
    expect(html).toContain('href="/admin-ui/catalog/categories/a"');
    expect(html).not.toContain('aria-expanded="true"');
    expectTranslated(html, ["Name a", "Name b", "slug-a", "slug-b", "+"]);
  });

  it("an expanded category shows its children one level down and links its group to the button", () => {
    const child = item({ id: "c", category: category("c", "a"), depth: 2 });
    const html = tree([
      item({ id: "a", expanded: true, childStatus: "loaded", children: [child] }),
    ]);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-controls="category-tree-a"');
    expect(html).toContain('id="category-tree-a"');
    expect(html).toContain('href="/admin-ui/catalog/categories/c"');
    expect(html.match(/<ul/g)?.length).toBe(2);
  });

  it("shows loading, a failure with a retry, an empty level and a load-more button for the expanded states", () => {
    expect(tree([item({ id: "a", expanded: true, childStatus: "loading" })])).toContain(
      'role="status"',
    );
    const failed = tree([item({ id: "a", expanded: true, childStatus: "error" })]);
    expect(failed).toContain("§dict.category.childrenFailed");
    expect(failed).toContain("§action.retry");
    expect(tree([item({ id: "a", expanded: true, childStatus: "loaded" })])).toContain(
      "§dict.category.noChildren",
    );
    const more = tree([
      item({
        id: "a",
        expanded: true,
        childStatus: "loaded",
        hasMore: true,
        children: [item({ id: "c", category: category("c", "a"), depth: 2 })],
      }),
    ]);
    expect(more).toContain("§dict.category.loadMoreChildren");
  });

  it("has no expand button at the maximum depth", () => {
    const html = tree([item({ id: "deep", depth: MAX_CATEGORY_DEPTH, canExpand: false })]);
    expect(html).not.toContain("aria-expanded");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("§dict.category.addChild");
  });

  it("offers 'add subcategory' with the parent in the link for a writer only, and marks an inactive category", () => {
    const writer = tree([item({ id: "a", category: category("a", null, { isActive: false }) })]);
    expect(writer).toContain('href="/admin-ui/catalog/categories/new?parentId=a"');
    expect(writer).toContain("§dict.category.addChild");
    expect(writer).toContain("§dict.category.inactive");
    const viewer = tree([item({ id: "a" })], false);
    expect(viewer).not.toContain("categories/new");
    expect(viewer).not.toContain("§dict.category.addChild");
  });
});

// ---------------------------------------------------- the real messages, both languages

describe("the screens with the real uk and en messages", () => {
  it("render every state without a missing key (the real translator throws on one)", async () => {
    const sentinel = t;
    try {
      for (const locale of ["uk", "en"] as const) {
        t = createTranslator(await messagesForArea(locale, MESSAGE_FILES), locale);
        const base = emptyAttributeForm(content.locales);
        for (const type of [
          "text",
          "number",
          "boolean",
          "select",
          "multiselect",
          "date",
        ] as const) {
          for (const canWrite of [true, false]) {
            for (const mode of ["create", "edit"] as const) {
              expect(
                attributeForm(changeInputType(base, type), { canWrite, mode, summary: true }),
              ).toContain("<form");
            }
          }
        }
        for (const canWrite of [true, false]) {
          expect(itemsSection(canWrite)).toContain("wool");
          expect(list(ready(rows, 5), canWrite, { offset: 2 })).toContain("alpha");
          expect(list(ready([]), canWrite)).toContain("<h2");
          expect(list({ status: "loading" }, canWrite)).toContain("<table");
          expect(list({ status: "error", failure: { kind: "timeout" } }, canWrite)).toContain(
            "<button",
          );
          expect(
            tree(
              [item({ id: "a", expanded: true, childStatus: "loaded", hasMore: true })],
              canWrite,
            ),
          ).toContain("<nav");
        }
        for (const kind of [
          "saved",
          "noChanges",
          "itemSaved",
          "itemDeleted",
          "assignmentSaved",
          "assignmentRemoved",
          "moved",
          "unknown",
        ] as const) {
          expect(renderInRouter(<NoticeBar t={t} notice={{ kind, n: 1 }} />)).toContain("<p");
        }
        expect(renderInRouter(<DictionaryNav t={t} current="categories" />)).toContain("<nav");
      }
    } finally {
      t = sentinel;
    }
  });
});

// ----------------------------------------------------------------------- dialogs

describe("dialogs", () => {
  const confirm = (canWrite: boolean) =>
    renderInRouter(
      <ConfirmDelete
        t={t}
        canWrite={canWrite}
        open
        onClose={noop}
        remove={async () => ({ ok: true, status: 204, data: undefined })}
        onDeleted={noop}
        onUnknown={noop}
        title="§title"
        description="§description"
        hint="§hint"
        confirmLabel="§confirm"
      />,
    );

  it("asks before deleting: an alert dialog with the danger button, cancel first, and nothing without write permission", () => {
    const html = confirm(true);
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain("§title");
    expect(html).toMatch(/<button[^>]*border-danger[^>]*>§confirm/);
    expect(html.indexOf("§dict.form.cancel")).toBeLessThan(html.indexOf("§confirm"));
    expect(html).toContain("data-autofocus");
    expect(html).not.toContain("§hint");
    expect(confirm(false)).toBe("");
  });

  it("puts the form inside the dialog and links the submit button of the footer to it", () => {
    const html = renderInRouter(
      <FormDialog
        t={t}
        title="§title"
        formId=":r1:"
        busy={false}
        submitLabel="§save"
        busyLabel="§saving"
        onClose={noop}
        onSubmit={noop}
        summary={[]}
      >
        <p>§body</p>
      </FormDialog>,
    );
    expect(html).toMatch(/<form id=":r1:"[^>]*method="post"/);
    expect(html).not.toMatch(/<form[^>]*action=/);
    expect(html).toMatch(/<button[^>]*form=":r1:"[^>]*>§save/);
    const busy = renderInRouter(
      <FormDialog
        t={t}
        title="§title"
        formId=":r1:"
        busy
        submitLabel="§save"
        busyLabel="§saving"
        onClose={noop}
        onSubmit={noop}
        summary={[]}
      >
        <p>§body</p>
      </FormDialog>,
    );
    expect(busy).toContain("§saving");
    expect(busy).not.toContain(">§save<");
  });
});
