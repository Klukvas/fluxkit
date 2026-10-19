import { createTranslator } from "@fluxkit/ui";
import { describe, expect, it } from "vitest";
import { attributeRows } from "./attributes";
import { product } from "./test-fixtures";

const t = createTranslator({ "product.attribute.yes": "Yes", "product.attribute.no": "No" }, "en");

function definition(
  code: string,
  inputType: "text" | "number" | "boolean" | "select" | "multiselect" | "date",
  unit: string | null = null,
) {
  return {
    code,
    name: `Name of ${code}`,
    inputType,
    isLocalized: false,
    unit,
    isFilterable: false,
    isComparable: false,
    isSortable: false,
    options: [],
  };
}

describe("attributeRows", () => {
  it("lists the attributes in definition order with the API's names, whatever their codes", () => {
    const rows = attributeRows(
      product({
        attributeDefinitions: [definition("b_attr", "text"), definition("a_attr", "text")],
        attributes: { a_attr: "second", b_attr: "first" },
      }),
      t,
      "en",
    );
    expect(rows).toEqual([
      { code: "b_attr", name: "Name of b_attr", text: "first" },
      { code: "a_attr", name: "Name of a_attr", text: "second" },
    ]);
  });

  it("formats every value type from data, not from code names", () => {
    const rows = attributeRows(
      product({
        attributeDefinitions: [
          definition("flag", "boolean"),
          definition("off", "boolean"),
          definition("amount", "number", "g"),
          definition("plain", "number"),
          definition("kind", "select"),
          definition("kinds", "multiselect"),
          definition("made", "date"),
        ],
        attributes: {
          flag: true,
          off: false,
          amount: { value: 1250.5, unit: "g" },
          plain: { value: 3, unit: null },
          kind: { code: "x", label: "Label X" },
          kinds: [
            { code: "x", label: "Label X" },
            { code: "y", label: "Label Y" },
          ],
          made: "2026-10-18",
        },
      }),
      t,
      "en",
    );
    expect(rows.map((row) => row.text)).toEqual([
      "Yes",
      "No",
      "1,250.5 g",
      "3",
      "Label X",
      "Label X, Label Y",
      "October 18, 2026",
    ]);
  });

  it("formats numbers for the locale", () => {
    const rows = attributeRows(
      product({
        attributeDefinitions: [definition("amount", "number", "g")],
        attributes: { amount: { value: 1250.5, unit: "g" } },
      }),
      createTranslator({ "product.attribute.yes": "Так", "product.attribute.no": "Ні" }, "uk"),
      "uk",
    );
    expect(rows[0]?.text).toMatch(/^1\s250,5\sg$/);
  });

  it("skips a definition without a value and a value without a definition (nothing is invented)", () => {
    const rows = attributeRows(
      product({
        attributeDefinitions: [definition("only_defined", "text")],
        attributes: { orphan: "x" },
      }),
      t,
      "en",
    );
    expect(rows).toEqual([]);
  });

  it("returns text only: markup in a value stays literal characters", () => {
    const rows = attributeRows(
      product({
        attributeDefinitions: [definition("note", "text")],
        attributes: { note: "<b>bold</b>" },
      }),
      t,
      "en",
    );
    expect(rows[0]?.text).toBe("<b>bold</b>");
  });
});

describe("attribute codes that are names of Object.prototype members (review L2)", () => {
  const reserved = ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"];

  it("skips a definition without a value instead of reading the inherited member", () => {
    const rows = attributeRows(
      product({
        attributeDefinitions: reserved.map((code) => definition(code, "text")),
        attributes: {},
      }),
      t,
      "en",
    );
    expect(rows).toEqual([]);
  });

  it("shows the value of an attribute whose code is such a name", () => {
    const attributes = JSON.parse(`{"constructor":"c","__proto__":"p","toString":"s"}`) as Record<
      string,
      string
    >;
    const rows = attributeRows(
      product({
        attributeDefinitions: ["constructor", "__proto__", "toString"].map((code) =>
          definition(code, "text"),
        ),
        attributes,
      }),
      t,
      "en",
    );
    expect(rows.map((row) => row.text)).toEqual(["c", "p", "s"]);
  });
});
