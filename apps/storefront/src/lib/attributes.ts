import type { AttributeValue, ProductDetail } from "@fluxkit/api-client";
import type { Translator } from "@fluxkit/ui";
import { formatDate } from "./date";

export interface AttributeRow {
  code: string;
  name: string;
  /** Plain text. It is rendered as text, never as markup. */
  text: string;
}

function isOption(value: unknown): value is { code: string; label: string } {
  return typeof value === "object" && value !== null && "label" in value && "code" in value;
}

function format(value: AttributeValue, inputType: string, t: Translator, locale: string): string {
  if (typeof value === "boolean")
    return t(value ? "product.attribute.yes" : "product.attribute.no");
  if (typeof value === "string") {
    // A date is a calendar day without a time zone: format it in UTC so the day cannot shift.
    return inputType === "date" ? formatDate(value, locale, { timeZone: "UTC" }) : value;
  }
  if (Array.isArray(value)) return value.map((option) => option.label).join(", ");
  if (isOption(value)) return value.label;
  const number = new Intl.NumberFormat(locale).format(value.value);
  return value.unit === null ? number : `${number} ${value.unit}`;
}

/**
 * The attributes the API says are visible on the storefront, as label/value rows in the definitions' order. Data driven:
 * names, value types and units all come from the API (`attributeDefinitions`), no attribute code is known here. Internal
 * attributes never arrive (the API filters them, AGENTS.md section 2.3); a definition without a value is skipped.
 */
export function attributeRows(
  product: Pick<ProductDetail, "attributes" | "attributeDefinitions">,
  t: Translator,
  locale: string,
): AttributeRow[] {
  const rows: AttributeRow[] = [];
  for (const definition of product.attributeDefinitions) {
    // Own properties only: `constructor` and `toString` are valid attribute codes, and `attributes[code]` would find the inherited member.
    if (!Object.hasOwn(product.attributes, definition.code)) continue;
    const value = product.attributes[definition.code];
    if (value === undefined) continue;
    rows.push({
      code: definition.code,
      name: definition.name,
      text: format(value, definition.inputType, t, locale),
    });
  }
  return rows;
}
