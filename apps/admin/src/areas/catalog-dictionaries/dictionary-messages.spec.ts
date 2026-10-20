import { describe, expect, it } from "vitest";
import { messagesByLocale } from "../../messages";
import { ATTRIBUTE_FLAGS, ATTRIBUTE_INPUT_TYPES, VALIDATION_FIELDS } from "./attribute-form";
import { DICTIONARY_SCREENS, NOTICE_KINDS } from "./dictionary-frame";
import { ITEM_MESSAGE_SUFFIXES } from "./items-section";

/**
 * The screens build some message keys from data (`dict.${prefix}.heading`, `dict.inputType.${type}`, ...), which the
 * generic "keys used in the source" test cannot see. This one lists every such family and checks both languages, so a
 * missing key is a test failure and not a thrown error in front of an admin.
 */
const families: Record<string, string[]> = {
  "dict.attributeOption": [...ITEM_MESSAGE_SUFFIXES],
  "dict.optionValue": [...ITEM_MESSAGE_SUFFIXES],
  "dict.option": ["code", "codeHint", "name", "create"],
  "dict.productType": ["code", "codeHint", "name", "create"],
  "dict.inputType": [...ATTRIBUTE_INPUT_TYPES],
  "dict.level": ["product", "variant"],
  "dict.attribute.flag": [...ATTRIBUTE_FLAGS],
  "dict.notice": NOTICE_KINDS.filter((kind) => kind !== "unknown"),
};

function expected(): string[] {
  const keys = Object.entries(families).flatMap(([prefix, suffixes]) =>
    suffixes.map((suffix) => `${prefix}.${suffix}`),
  );
  for (const [type, specs] of Object.entries(VALIDATION_FIELDS)) {
    for (const spec of specs) {
      keys.push(`dict.attribute.validation.${spec.key}`);
      if (spec.kind !== "boolean") keys.push(`dict.attribute.validationHint.${type}.${spec.key}`);
    }
  }
  for (const screen of DICTIONARY_SCREENS) keys.push(screen.titleKey);
  return keys;
}

describe("dictionary message keys built from data", () => {
  it("exist in uk and en", () => {
    const keys = expected();
    expect(keys.length).toBeGreaterThan(80);
    for (const locale of ["uk", "en"] as const) {
      const missing = keys.filter((key) => !(key in messagesByLocale[locale]));
      expect(missing, locale).toEqual([]);
    }
  });
});
