import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { Alert } from "./alert";
import { Badge } from "./badge";
import { Breadcrumbs } from "./breadcrumbs";
import { Checkbox } from "./checkbox";
import { EmptyState } from "./empty-state";
import { Field } from "./field";
import { Input } from "./input";
import { OptionPicker } from "./option-picker";
import { Pagination } from "./pagination";
import { PriceText } from "./price-text";
import { ProductImage } from "./product-image";
import { QuantityInput } from "./quantity-input";
import { SkipLink } from "./skip-link";
import { Spinner } from "./spinner";
import { render, text } from "./test-helpers";

// Every user-facing string must come from props (AGENTS.md section 2.2). Each component is rendered with sentinel
// strings only; any other word in the visible text or in an aria-label/alt/title would be a hardcoded string.
// Allowed non-word glyphs: decorative separators and gap marks.
const s = (name: string): string => `§${name}`;

const cases: [string, ReactElement][] = [
  [
    "Alert",
    <Alert key="a" title={s("title")}>
      {s("body")}
    </Alert>,
  ],
  ["Badge", <Badge key="b">{s("badge")}</Badge>],
  [
    "Breadcrumbs",
    <Breadcrumbs
      key="c"
      label={s("nav")}
      items={[{ label: s("home"), href: "/" }, { label: s("here") }]}
    />,
  ],
  ["Checkbox", <Checkbox key="d" label={s("check")} />],
  ["EmptyState", <EmptyState key="e" title={s("t")} description={s("d")} action={s("act")} />],
  [
    "Field",
    <Field
      key="f"
      id="x"
      label={s("label")}
      hint={s("hint")}
      error={s("error")}
      required
      requiredIndicator={s("req")}
    >
      {(control) => <Input {...control} />}
    </Field>,
  ],
  [
    "OptionPicker",
    <OptionPicker
      key="g"
      name="o"
      legend={s("legend")}
      values={[{ value: "v", label: s("v") }]}
      selected={null}
      onChange={() => undefined}
    />,
  ],
  [
    "Pagination",
    <Pagination
      key="h"
      label={s("nav")}
      currentPage={5}
      pageCount={12}
      hrefForPage={(page) => `/${page}`}
      previousLabel={s("prev")}
      nextLabel={s("next")}
      pageLabel={(page) => s(`page${page}`)}
    />,
  ],
  [
    "PriceText",
    <PriceText
      key="i"
      price={s("p")}
      priceLabel={s("now")}
      compareAt={s("c")}
      compareAtLabel={s("was")}
    />,
  ],
  ["ProductImage placeholder", <ProductImage key="j" alt={s("alt")} width={1} height={1} />],
  [
    "QuantityInput",
    <QuantityInput
      key="k"
      value={1}
      onChange={() => undefined}
      label={s("qty")}
      decreaseLabel={s("dec")}
      increaseLabel={s("inc")}
    />,
  ],
  [
    "SkipLink",
    <SkipLink key="l" targetId="main">
      {s("skip")}
    </SkipLink>,
  ],
  ["Spinner", <Spinner key="m" label={s("loading")} />],
];

describe("no hardcoded user-facing text in ui components", () => {
  for (const [name, element] of cases) {
    it(`${name} renders only strings it was given`, () => {
      const markup = render(element);
      const visible = text(markup)
        .replaceAll(/§\w+/g, "")
        .replaceAll(/[\s…/*]/g, "");
      expect(visible, `unexpected text in ${markup}`).toBe("");
      for (const match of markup.matchAll(/\s(aria-label|alt|title|placeholder)="([^"]*)"/g)) {
        expect(match[2], `${match[1]} in ${markup}`).toMatch(/^§\w+$|^$/);
      }
    });
  }
});
