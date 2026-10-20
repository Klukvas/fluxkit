import { createTranslator, type Translator } from "@fluxkit/ui";
import { describe, expect, it } from "vitest";
import {
  leftoverText,
  messagesForArea,
  renderInRouter,
  sentinelTranslator,
} from "../../test-helpers";
import { MESSAGE_FILES } from "./index";
import { emptyProductForm } from "./product-form";
import { ProductGeneralView } from "./product-general-view";

const content = { defaultLocale: "uk", locales: ["uk", "en"] };
const noop = () => undefined;

function render(
  mode: "create" | "edit",
  canWrite: boolean,
  options: { t?: Translator; summary?: boolean } = {},
) {
  return renderInRouter(
    <ProductGeneralView
      t={options.t ?? sentinelTranslator()}
      uiLocale="en"
      content={content}
      mode={mode}
      values={{
        ...emptyProductForm(content.locales),
        slug: mode === "edit" ? "first-product" : "",
        description: { uk: "<b>not html</b>", en: "" },
      }}
      onChange={noop}
      issues={options.summary === true ? { slug: { key: "dict.error.slugFormat" } } : {}}
      summary={options.summary === true ? [{ key: "dict.form.checkFields" }] : []}
      busy={false}
      canWrite={canWrite}
      onSubmit={noop}
      typePicker={mode === "create" ? <p>type-picker</p> : undefined}
      brandPicker={<p>brand-picker</p>}
      cancelTo="/products"
    />,
  );
}

const tagOf = (html: string, id: string) =>
  new RegExp(`<(?:input|textarea)\\b[^>]*\\bid="${id}"[^>]*>`).exec(html)?.[0] ?? "";

describe("product general form screen", () => {
  it("creates: a post form without action, required default-locale title, optional slug, a create button", () => {
    const html = render("create", true);
    expect(html).toMatch(/<form\b[^>]*method="post"/);
    expect(html).not.toMatch(/<form[^>]*action=/);
    expect(tagOf(html, "product-title-uk")).toContain("required");
    expect(tagOf(html, "product-title-en")).not.toContain("required");
    expect(tagOf(html, "product-slug")).not.toContain("required");
    expect(html).toContain("type-picker");
    expect(html).toContain("§products.form.create");
    expect(
      leftoverText(
        html
          .replace("type-picker", "")
          .replace("brand-picker", "")
          .replace("&lt;b&gt;not html&lt;/b&gt;", ""),
      ),
    ).toBe("");
  });

  it("renders a description as text in a textarea, never as markup", () => {
    const html = render("edit", true);
    expect(html).toContain("&lt;b&gt;not html&lt;/b&gt;");
    expect(html).not.toContain("<b>not html</b>");
  });

  it("edits: the slug is required and there is a save button", () => {
    const html = render("edit", true);
    expect(tagOf(html, "product-slug")).toContain("required");
    expect(html).toContain("§products.form.save");
    expect(html).not.toContain("type-picker");
  });

  it("is read-only for a viewer: every field readOnly, no button at all", () => {
    const html = render("edit", false);
    for (const id of [
      "product-title-uk",
      "product-title-en",
      "product-description-uk",
      "product-slug",
    ]) {
      expect(tagOf(html, id), id).toMatch(/readOnly=""/);
    }
    expect(html).not.toContain("<button");
    expect(html).not.toContain("§products.form.save");
  });

  it("shows the summary and the field error", () => {
    const html = render("edit", true, { summary: true });
    expect(html).toContain("§dict.form.checkFields");
    expect(html).toContain("§dict.error.slugFormat");
    expect(tagOf(html, "product-slug")).toContain('aria-invalid="true"');
  });

  it("renders with the real uk and en messages", async () => {
    for (const locale of ["uk", "en"] as const) {
      const t = createTranslator(await messagesForArea(locale, MESSAGE_FILES), locale);
      for (const mode of ["create", "edit"] as const) {
        for (const canWrite of [true, false]) {
          expect(render(mode, canWrite, { t, summary: true })).toContain("<form");
        }
      }
    }
  });
});
