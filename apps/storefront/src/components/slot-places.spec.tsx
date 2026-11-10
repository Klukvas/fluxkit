import { Badge } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { messagesByLocale } from "../messages";
import { contactsView } from "../lib/contacts";
import { cardDisplay } from "../lib/product-card-model";
import type {
  FooterColumnsSlotProps,
  HeaderTopSlotProps,
  ProductCardSlotProps,
  SlotRegistry,
} from "../lib/slots";
import { summary } from "../lib/test-fixtures";
import { resolveCard } from "./cards/registry";
import { I18nProvider } from "./i18n-provider";
import { SessionProvider } from "./session-provider";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { sentinelTranslator } from "./test-helpers";

/**
 * Where each slot of `config/slots.tsx` renders (plan 2026-11-08-design-changeability.md, S1; `docs/contracts/slots.md`). Each
 * case renders the same thing twice, with no components and with some: the filled markup must be the empty markup plus the
 * components' output (and, where the contract says so, the slot's frame) at the slot's place, and nothing else. The real
 * config is replaced here, so this spec is independent of what a fork registers.
 */
const registry = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock("../config/slots", () => ({ slots: registry }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/uk/catalog",
  useSearchParams: () => new URLSearchParams(),
}));

const t = sentinelTranslator();
const sentinelMessages = Object.fromEntries(
  Object.keys(messagesByLocale.uk).map((key) => [key, `§${key}`]),
);

function fill(slots: SlotRegistry): void {
  for (const key of Object.keys(registry)) Reflect.deleteProperty(registry, key);
  Object.assign(registry, slots);
}

afterEach(() => {
  fill({});
});

/**
 * The markup with React's `useId` values made equal: they derive from the position in the tree, so components put before an
 * island (the search box, the theme switch) shift them. Which ids an island gets is not part of a slot's place.
 */
function sameIds(html: string): string {
  return html.replace(/_R_[0-9A-Za-z]+_/g, "_R_id_");
}

function renderHeader(): string {
  return sameIds(
    renderToStaticMarkup(
      <I18nProvider locale="uk" messages={sentinelMessages}>
        <SessionProvider locale="uk">
          <SiteHeader locale="uk" t={t} categories={[]} searchEnabled />
        </SessionProvider>
      </I18nProvider>,
    ),
  );
}

const shopLinks = [{ labelKey: "shopPages.about.title", href: "/about" }];
const contacts = contactsView({
  phones: [{ tel: "+380441234567", display: "+380 44 123 45 67" }],
  email: "hello@example.com",
  addressKey: null,
  hoursKey: null,
  links: [],
  mapHref: null,
});

function renderFooter(): string {
  return sameIds(
    renderToStaticMarkup(
      <I18nProvider locale="uk" messages={sentinelMessages}>
        <SiteFooter
          locale="uk"
          t={t}
          year={2026}
          themeMode="light"
          showThemeSwitch
          shopLinks={shopLinks}
          contacts={contacts}
        />
      </I18nProvider>,
    ),
  );
}

const card = cardDisplay({
  product: summary("a", { title: "§a" }, "low_stock"),
  locale: "uk",
  t,
  exponent: 2,
  imageHosts: [],
  brandPath: "/catalog?brand=demo-brand",
});

function renderCard(kind: "grid" | "list"): string {
  const { Card } = resolveCard(kind);
  return renderToStaticMarkup(
    <Card card={card} headingLevel="h2" eager={false} locale="uk" t={t} />,
  );
}

/** `html` with `inserted` put in right before the first `before` (which must occur). */
function insertBefore(html: string, before: string, inserted: string): string {
  const index = html.indexOf(before);
  expect(index, before).toBeGreaterThanOrEqual(0);
  return html.slice(0, index) + inserted + html.slice(index);
}

/** `html` with `inserted` put in right after the first `after` (which must occur). */
function insertAfter(html: string, after: string, inserted: string): string {
  const index = html.indexOf(after);
  expect(index, after).toBeGreaterThanOrEqual(0);
  return html.slice(0, index + after.length) + inserted + html.slice(index + after.length);
}

describe("header.top", () => {
  function Bar({ locale, t: translate }: HeaderTopSlotProps) {
    return <p data-bar={locale}>{translate("nav.menu")}</p>;
  }
  function Second() {
    return <p data-second="" />;
  }

  it("renders its components first inside the header, before the header row, with no element around them", () => {
    const empty = renderHeader();
    fill({ "header.top": [Bar, Second] });
    expect(renderHeader()).toBe(
      insertAfter(
        empty,
        '<header class="fk-site-header">',
        '<p data-bar="uk">§nav.menu</p><p data-second=""></p>',
      ),
    );
  });
});

describe("footer.columns", () => {
  function Column({
    shopLinks: links,
    legalLinks,
    contacts: view,
    t: translate,
  }: FooterColumnsSlotProps) {
    return (
      <div data-column="">
        {translate("footer.nav.label")}|
        {links.map((link) => `${link.label}=${link.href}`).join(",")}|
        {legalLinks.length > 0 ? "legal" : "no legal"}|{view.email?.text}
      </div>
    );
  }

  it("renders its components as the columns of one grid at the top of the footer, before the configured blocks", () => {
    const empty = renderFooter();
    fill({ "footer.columns": [Column] });
    const column =
      '<div data-column="">§footer.nav.label|§shopPages.about.title=/uk/about|legal|hello@example.com</div>';
    const filled = renderFooter();
    expect(filled).toBe(insertBefore(empty, "<nav", `<div class="grid gap-6">${column}</div>`));
  });

  it("lays out up to four columns side by side from the small breakpoint, more wrap into rows of four", () => {
    const expected: Record<number, string> = {
      1: "grid gap-6",
      2: "grid gap-6 sm:grid-cols-2",
      3: "grid gap-6 sm:grid-cols-2 lg:grid-cols-3",
      4: "grid gap-6 sm:grid-cols-2 lg:grid-cols-4",
      5: "grid gap-6 sm:grid-cols-2 lg:grid-cols-4",
    };
    for (const [count, className] of Object.entries(expected)) {
      fill({ "footer.columns": Array.from({ length: Number(count) }, () => Column) });
      expect(renderFooter()).toContain(`<div class="${className}"><div data-column="">`);
    }
  });
});

describe("product-card.badges and product-card.actions", () => {
  function New({ card: model, kind }: ProductCardSlotProps) {
    return <Badge variant="neutral">{`new:${model.id}:${kind}`}</Badge>;
  }
  function Compare({ card: model, locale }: ProductCardSlotProps) {
    return <a href={`/${locale}/compare?id=${model.id}`}>compare</a>;
  }
  const badge = renderToStaticMarkup(<Badge variant="neutral">new:id-a:grid</Badge>);
  const listBadge = renderToStaticMarkup(<Badge variant="neutral">new:id-a:list</Badge>);
  const action = '<a href="/uk/compare?id=id-a">compare</a>';

  it("renders the badges in a row under the image and the actions over the image's top right corner of the grid card", () => {
    const empty = renderCard("grid");
    fill({ "product-card.badges": [New], "product-card.actions": [Compare] });
    const withBadges = insertBefore(
      empty,
      '<a class="relative z-10',
      `<div class="flex flex-wrap gap-1">${badge}</div>`,
    );
    expect(renderCard("grid")).toBe(
      insertBefore(
        withBadges,
        "</article>",
        `<div class="absolute top-5 right-5 z-10 flex gap-1">${action}</div>`,
      ),
    );
  });

  it("renders the badges above the title and the actions at the end of the price row of the list card", () => {
    const empty = renderCard("list");
    fill({ "product-card.badges": [New], "product-card.actions": [Compare] });
    const withBadges = insertBefore(
      empty,
      '<a class="relative z-10',
      `<div class="flex flex-wrap gap-1">${listBadge}</div>`,
    );
    const priceRowEnd = "</div></div></article>";
    expect(renderCard("list")).toBe(
      insertBefore(
        withBadges,
        priceRowEnd,
        `<div class="relative z-10 ms-auto flex gap-1">${action}</div>`,
      ),
    );
  });

  it("adds nothing to a card while the card slots are empty, whatever the other slots hold", () => {
    const empty = { grid: renderCard("grid"), list: renderCard("list") };
    fill({ "header.top": [() => "top"], "footer.columns": [() => "column"] });
    expect(renderCard("grid")).toBe(empty.grid);
    expect(renderCard("list")).toBe(empty.list);
  });
});
