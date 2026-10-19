import { describe, expect, it } from "vitest";
import { LocaleTextField, type LocaleTextFieldLocale } from "./locale-text-field";
import { render, tags } from "./test-helpers";

const locales: LocaleTextFieldLocale[] = [
  { locale: "uk", label: "Title (Ukrainian)", required: true },
  { locale: "en", label: "Title (English)", hint: "Optional" },
];

const field = (
  props: Partial<Parameters<typeof LocaleTextField>[0]> = {},
  list = locales,
): string =>
  render(
    <LocaleTextField
      id="title"
      legend="Title"
      locales={list}
      values={{ uk: "Кружка", en: "" }}
      onChange={() => undefined}
      requiredIndicator="*"
      {...props}
    />,
  );

describe("LocaleTextField", () => {
  it("groups one labelled field per locale under a legend", () => {
    const markup = field();
    expect(tags(markup, "fieldset")).toHaveLength(1);
    expect(markup).toMatch(/<legend[^>]*>Title<\/legend>/);
    expect(tags(markup, "label")).toHaveLength(2);
    const inputs = tags(markup, "input");
    expect(inputs.map((input) => input.attributes.id)).toEqual(["title-uk", "title-en"]);
    expect(tags(markup, "label").map((label) => label.attributes.for)).toEqual([
      "title-uk",
      "title-en",
    ]);
  });

  it("marks the content language of each control", () => {
    expect(tags(field(), "input").map((input) => input.attributes.lang)).toEqual(["uk", "en"]);
  });

  it("shows the current values", () => {
    expect(tags(field(), "input").map((input) => input.attributes.value)).toEqual(["Кружка", ""]);
  });

  it("requires only the locales marked required through props", () => {
    const inputs = tags(field(), "input");
    expect(inputs[0]?.attributes.required).toBe(true);
    expect(inputs[1]?.attributes).not.toHaveProperty("required");
    expect(field()).toContain(">*<");
    expect(field().match(/>\*</g)).toHaveLength(1);
  });

  it("wires a per-locale hint and error with aria-describedby", () => {
    const markup = field({}, [
      { locale: "uk", label: "Uk", required: true, error: "Required" },
      { locale: "en", label: "En", hint: "Optional" },
    ]);
    const [uk, en] = tags(markup, "input");
    expect(uk?.attributes["aria-invalid"]).toBe("true");
    expect(uk?.attributes["aria-describedby"]).toBe("title-uk-error");
    expect(en?.attributes).not.toHaveProperty("aria-invalid");
    expect(en?.attributes["aria-describedby"]).toBe("title-en-hint");
    expect(markup).toContain('id="title-uk-error"');
    expect(markup).toContain('id="title-en-hint"');
  });

  it("renders textareas when multiline", () => {
    const markup = field({ multiline: true });
    expect(tags(markup, "textarea")).toHaveLength(2);
    expect(tags(markup, "input")).toHaveLength(0);
    expect(tags(markup, "textarea")[0]?.attributes.lang).toBe("uk");
    expect(markup).toContain(">Кружка</textarea>");
  });

  it("can be read-only", () => {
    const readOnly = tags(field({ readOnly: true }), "input");
    expect(readOnly.every((input) => "readOnly" in input.attributes)).toBe(true);
    expect(tags(field(), "input")[0]?.attributes).not.toHaveProperty("readOnly");
  });

  it("renders an empty value for a locale missing from the values", () => {
    const markup = field({ values: {} });
    expect(tags(markup, "input").map((input) => input.attributes.value)).toEqual(["", ""]);
  });
});
