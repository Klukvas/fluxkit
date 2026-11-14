import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { Alert } from "./alert";
import { Badge } from "./badge";
import { BannerCard } from "./banner-card";
import { Breadcrumbs } from "./breadcrumbs";
import { Checkbox } from "./checkbox";
import { ConfirmDialog } from "./confirm-dialog";
import { DataTable } from "./data-table";
import { DescriptionList } from "./description-list";
import { Dialog } from "./dialog";
import { EmptyState } from "./empty-state";
import { Field } from "./field";
import { FilterBar } from "./filter-bar";
import { Input } from "./input";
import { LiveRegion } from "./live-region";
import { LocaleTextField } from "./locale-text-field";
import { OptionPicker } from "./option-picker";
import { Pagination } from "./pagination";
import { PriceText } from "./price-text";
import { ProductImage } from "./product-image";
import { QuantityInput } from "./quantity-input";
import { HomeIcon } from "./icons";
import { SideNav } from "./side-nav";
import { SkipLink } from "./skip-link";
import { Spinner } from "./spinner";
import { StatusBadge } from "./status-badge";
import { StepIndicator } from "./step-indicator";
import { Tabs } from "./tabs";
import { TrustBar } from "./trust-bar";
import { Disclosure } from "./disclosure";
import { Hero } from "./hero";
import { MarkdownView } from "./markdown-view";
import { render, text } from "./test-helpers";

// Every user-facing string must come from props (AGENTS.md section 2.2). Each component is rendered with sentinel
// strings only; any other word in the visible text or in an aria-label/alt/title would be a hardcoded string.
// Allowed besides sentinels: digits (page numbers) and decorative glyphs (separators, gap mark, plus, minus).
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
  [
    "DataTable",
    <DataTable
      key="n"
      caption={s("caption")}
      columns={[
        { id: "a", header: s("colA"), cell: (row: { v: string }) => row.v },
        { id: "b", header: s("colB"), cell: (row: { v: string }) => row.v },
      ]}
      rows={[{ v: s("cell") }]}
      rowKey={(row) => row.v}
      emptyMessage={s("empty")}
      actions={{ header: s("actions"), render: (row) => row.v }}
    />,
  ],
  [
    "DataTable empty",
    <DataTable
      key="n2"
      caption={s("caption")}
      captionHidden
      columns={[{ id: "a", header: s("colA"), cell: (row: { v: string }) => row.v }]}
      rows={[]}
      rowKey={(row) => row.v}
      emptyMessage={s("empty")}
    />,
  ],
  [
    "DataTable loading",
    <DataTable
      key="n3"
      caption={s("caption")}
      columns={[{ id: "a", header: s("colA"), cell: (row: { v: string }) => row.v }]}
      rows={[]}
      rowKey={(row) => row.v}
      emptyMessage={s("empty")}
      loading
      loadingLabel={s("loading")}
    />,
  ],
  [
    "Dialog",
    <Dialog
      key="o"
      open
      onClose={() => undefined}
      title={s("title")}
      description={s("desc")}
      footer={s("foot")}
    >
      {s("body")}
    </Dialog>,
  ],
  [
    "ConfirmDialog",
    <ConfirmDialog
      key="p"
      open
      tone="danger"
      busy
      title={s("title")}
      description={s("desc")}
      confirmLabel={s("confirm")}
      cancelLabel={s("cancel")}
      onConfirm={() => undefined}
      onClose={() => undefined}
    />,
  ],
  [
    "Tabs",
    <Tabs
      key="q"
      label={s("tabs")}
      tabs={[
        { id: "a", label: s("tabA") },
        { id: "b", label: s("tabB"), disabled: true },
      ]}
      selectedId="a"
      onChange={() => undefined}
    >
      {s("panel")}
    </Tabs>,
  ],
  [
    "DescriptionList",
    <DescriptionList key="r" items={[{ id: "a", term: s("term"), description: s("desc") }]} />,
  ],
  [
    "FilterBar",
    <FilterBar key="t" label={s("filters")}>
      {s("controls")}
    </FilterBar>,
  ],
  [
    "SideNav",
    <SideNav
      key="u"
      label={s("nav")}
      groups={[
        {
          id: "g",
          heading: s("group"),
          items: [{ id: "i", label: s("item"), href: "/x", current: true }],
        },
      ]}
    />,
  ],
  [
    "SideNav collapsed muted",
    <SideNav
      key="uc"
      label={s("nav")}
      collapsed
      currentTone="muted"
      groups={[
        {
          id: "g",
          heading: s("group"),
          items: [{ id: "i", label: s("item"), href: "/x", current: true, icon: <HomeIcon /> }],
        },
      ]}
    />,
  ],
  [
    "LocaleTextField",
    <LocaleTextField
      key="v"
      id="f"
      legend={s("legend")}
      locales={[
        { locale: "uk", label: s("uk"), required: true, hint: s("hint"), error: s("error") },
        { locale: "en", label: s("en") },
      ]}
      values={{}}
      onChange={() => undefined}
      requiredIndicator={s("req")}
    />,
  ],
  [
    "LocaleTextField multiline",
    <LocaleTextField
      key="v2"
      id="f"
      legend={s("legend")}
      multiline
      locales={[{ locale: "uk", label: s("uk") }]}
      values={{}}
      onChange={() => undefined}
    />,
  ],
  ["StatusBadge", <StatusBadge key="w" tone="success" label={s("status")} />],
  ["LiveRegion", <LiveRegion key="x">{s("saved")}</LiveRegion>],
  [
    "PriceText with a discount",
    <PriceText
      key="y1"
      price={s("p")}
      compareAt={s("c")}
      compareAtLabel={s("was")}
      discount={{ text: s("off"), label: s("save") }}
    />,
  ],
  [
    "OptionPicker with a sold-out value",
    <OptionPicker
      key="y2"
      name="o2"
      legend={s("legend")}
      values={[{ value: "v", label: s("v"), soldOut: true }]}
      selected={null}
      onChange={() => undefined}
      soldOutLabel={s("soldOut")}
    />,
  ],
  [
    "TrustBar",
    <TrustBar
      key="y3"
      label={s("trust")}
      items={[{ key: "a", icon: <svg aria-hidden="true" />, text: s("delivery") }]}
    />,
  ],
  [
    "Hero",
    <Hero
      key="y5"
      headingId="h"
      headingLevel="h1"
      title={s("title")}
      subline={s("subline")}
      action={<a href="/x">{s("cta")}</a>}
      media={<img src="/a.svg" alt="" width={4} height={3} />}
    />,
  ],
  [
    "StepIndicator",
    <StepIndicator
      key="y4"
      label={s("steps")}
      steps={[{ label: s("cart"), href: "/cart" }, { label: s("checkout") }, { label: s("order") }]}
      current={1}
      completedLabel={s("done")}
      compactText={s("compact")}
    />,
  ],
  [
    "BannerCard card",
    <BannerCard
      key="y6"
      id="b"
      layout="card"
      tone="accent"
      title={s("title")}
      text={s("text")}
      picture={<img src="/a.webp" alt="" width={2} height={1} />}
      renderLink={(props) => <a href="/x" {...props} />}
    />,
  ],
  [
    "BannerCard image",
    <BannerCard
      key="y7"
      id="i"
      layout="image"
      picture={<img src="/a.webp" alt={s("alt")} width={2} height={1} />}
      renderLink={(props) => <a href="/x" {...props} />}
    />,
  ],
  [
    "Disclosure",
    <Disclosure key="y5" title={s("title")} headingId="d">
      {s("body")}
    </Disclosure>,
  ],
  [
    "MarkdownView",
    <MarkdownView
      key="y8"
      localePrefix="/uk"
      document={{
        type: "document",
        children: [
          { type: "heading", level: 2, children: [{ type: "text", value: s("h") }] },
          {
            type: "paragraph",
            children: [
              { type: "text", value: s("p") },
              {
                type: "link",
                kind: "path",
                href: "/a",
                children: [{ type: "text", value: s("l") }],
              },
              {
                type: "link",
                kind: "https",
                href: "https://example.com",
                children: [{ type: "text", value: s("x") }],
              },
            ],
          },
          { type: "codeBlock", value: s("c") },
          {
            type: "blockquote",
            children: [{ type: "paragraph", children: [{ type: "text", value: s("q") }] }],
          },
          {
            type: "list",
            ordered: true,
            start: 2,
            items: [
              {
                type: "listItem",
                children: [{ type: "paragraph", children: [{ type: "text", value: s("i") }] }],
              },
            ],
          },
          { type: "thematicBreak" },
        ],
      }}
    />,
  ],
];

describe("no hardcoded user-facing text in ui components", () => {
  for (const [name, element] of cases) {
    it(`${name} renders only strings it was given`, () => {
      const markup = render(element);
      const visible = text(markup)
        .replaceAll(/§\w+/g, "")
        .replaceAll(/[\s\d…/*+\u2212]/g, "");
      expect(visible, `unexpected text in ${markup}`).toBe("");
      for (const match of markup.matchAll(/\s(aria-label|alt|title|placeholder)="([^"]*)"/g)) {
        expect(match[2], `${match[1]} in ${markup}`).toMatch(/^§\w+$|^$/);
      }
    });
  }
});
