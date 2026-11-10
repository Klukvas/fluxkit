import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { messagesByLocale } from "../messages";
import { contactsView } from "../lib/contacts";
import type { FooterConfig } from "../layout/footer-layout";
import type { HeaderConfig } from "../layout/header-layout";
import { I18nProvider } from "./i18n-provider";
import { SessionProvider } from "./session-provider";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { leftoverText, sentinelTranslator, textAttributes } from "./test-helpers";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/en",
  useSearchParams: () => new URLSearchParams(),
}));

const t = sentinelTranslator();
const sentinelMessages = Object.fromEntries(
  Object.keys(messagesByLocale.en).map((key) => [key, `§${key}`]),
);
const categories = [
  { slug: "shoes", name: "§cat-shoes" },
  { slug: "hats", name: "§cat-hats" },
  { slug: "bags", name: "§cat-bags" },
];
const contacts = contactsView({
  phones: [{ tel: "+380441234567", display: "+380 44 123 45 67" }],
  email: null,
  addressKey: null,
  hoursKey: null,
  links: [],
  mapHref: null,
});

function header(config: HeaderConfig, searchEnabled = true): string {
  return renderToStaticMarkup(
    <I18nProvider locale="en" messages={sentinelMessages}>
      <SessionProvider locale="en">
        <SiteHeader
          locale="en"
          t={t}
          categories={categories}
          searchEnabled={searchEnabled}
          config={config}
        />
      </SessionProvider>
    </I18nProvider>,
  );
}

function footer(
  config: FooterConfig,
  shopLinks = [{ labelKey: "shopPages.faq.title", href: "/faq" }],
  showThemeSwitch = true,
) {
  return renderToStaticMarkup(
    <SiteFooter
      locale="en"
      t={t}
      year={2026}
      themeMode="light"
      showThemeSwitch={showThemeSwitch}
      shopLinks={shopLinks}
      contacts={contacts}
      config={config}
    />,
  );
}

/** Positions of markers in the markup, to compare the rendered order with the configured one. */
function order(html: string, markers: readonly string[]): number[] {
  return markers.map((marker) => {
    const index = html.indexOf(marker);
    expect(index, marker).toBeGreaterThan(-1);
    return index;
  });
}
const ascending = (values: number[]) => [...values].sort((a, b) => a - b);

const markers = {
  menu: 'aria-label="§nav.menu"',
  logo: 'class="fk-logo"',
  navigation: 'class="fk-header-nav"',
  search: "fk-header-search",
  controls: 'class="fk-header-end"',
  language: 'aria-label="§locale.switcher.label"',
  cart: 'href="/en/cart"',
  account: "§nav.account.loading",
};

describe("SiteHeader follows config/header.ts", () => {
  it("renders the blocks and the controls in the configured order", () => {
    const html = header({
      blocks: ["logo", "search", "menu", "navigation", "controls"],
      controls: ["account", "cart", "language"],
      navigation: { categoryLimit: 6, links: [] },
    });
    const blocks = order(html, [
      markers.logo,
      markers.search,
      markers.menu,
      markers.navigation,
      markers.controls,
    ]);
    expect(blocks).toEqual(ascending(blocks));
    const controls = order(html, [markers.account, markers.cart, markers.language]);
    expect(controls).toEqual(ascending(controls));
  });

  it("leaves out unlisted blocks and controls, with no empty landmark or group", () => {
    const html = header({
      blocks: ["logo", "controls"],
      controls: ["cart"],
      navigation: { categoryLimit: 6, links: [{ labelKey: "nav.catalog", href: "/catalog" }] },
    });
    expect(html).not.toContain("<nav");
    expect(html).not.toContain("<details");
    expect(html).not.toContain(markers.search);
    expect(html).not.toContain(markers.language);
    expect(html).not.toContain(markers.account);
    expect(html).toContain(markers.cart);
    const noControls = header({
      blocks: ["logo"],
      controls: [],
      navigation: { categoryLimit: 0, links: [] },
    });
    expect(noControls).not.toContain(markers.controls);
  });

  it("limits the categories and puts the configured links after them, inline and in the menu alike", () => {
    const html = header({
      blocks: ["menu", "logo", "navigation"],
      controls: [],
      navigation: {
        categoryLimit: 2,
        links: [
          { labelKey: "nav.catalog", href: "/catalog" },
          { labelKey: "shopPages.faq.title", href: "/faq" },
        ],
      },
    });
    expect(html.match(/§cat-shoes/g)).toHaveLength(2);
    expect(html.match(/§cat-hats/g)).toHaveLength(2);
    expect(html).not.toContain("§cat-bags");
    const inline = html.slice(html.indexOf(markers.navigation));
    expect(
      order(inline, ["§cat-shoes", "§cat-hats", "§nav.catalog", "§shopPages.faq.title"]),
    ).toEqual(
      ascending(order(inline, ["§cat-shoes", "§cat-hats", "§nav.catalog", "§shopPages.faq.title"])),
    );
    expect(html.match(/<nav aria-label="§nav\.main\.label"/g)).toHaveLength(2);
  });

  it("opens the menu's panel towards the end from the first half of the row and towards the start from the second half; the controls' panels always towards the start", () => {
    const panelOf = (html: string, marker: string) =>
      /class="fk-menu-panel (start|end)-0/.exec(html.slice(html.indexOf(marker)))?.[1];
    const navigation = { categoryLimit: 2, links: [] };
    const orders: [HeaderConfig["blocks"], "start" | "end"][] = [
      [["menu", "logo", "navigation", "search", "controls"], "start"],
      [["logo", "menu", "navigation", "search", "controls"], "start"],
      [["logo", "navigation", "search", "menu", "controls"], "end"],
      [["logo", "search", "navigation", "menu", "controls"], "end"],
    ];
    for (const [blocks, expected] of orders) {
      const html = header({ blocks, controls: ["language", "account", "cart"], navigation });
      expect(panelOf(html, markers.menu), blocks.join()).toBe(expected);
      expect(panelOf(html, markers.language), blocks.join()).toBe("end");
    }
  });

  it("refuses a config with a structural problem at render (a fork that skipped the tests)", () => {
    expect(() =>
      header({
        blocks: ["controls", "logo"],
        controls: ["cart"],
        navigation: { categoryLimit: 0, links: [] },
      }),
    ).toThrow(/config\/header\.ts is invalid/);
  });

  it("shows no search box when the shop has search off, whatever the config lists", () => {
    const html = header(
      { blocks: ["logo", "search"], controls: [], navigation: { categoryLimit: 0, links: [] } },
      false,
    );
    expect(html).not.toContain(markers.search);
    expect(html).not.toContain('role="combobox"');
  });

  it("keeps every text a message", () => {
    const html = header({
      blocks: ["navigation", "logo", "search", "menu", "controls"],
      controls: ["language", "account", "cart"],
      navigation: { categoryLimit: 3, links: [{ labelKey: "nav.catalog", href: "/catalog" }] },
    });
    expect(leftoverText(html)).toBe("");
    for (const value of textAttributes(html)) expect(value.startsWith("§"), value).toBe(true);
  });
});

describe("SiteFooter follows config/footer.ts", () => {
  it("renders the blocks and the link groups in the configured order, the powered-by line always last", () => {
    const html = footer({
      blocks: ["copyright", "themeSwitch", "navigation", "contacts"],
      navigation: {
        groups: [
          { kind: "links", links: [{ labelKey: "nav.catalog", href: "/catalog" }] },
          { kind: "legal" },
          { kind: "shopPages" },
        ],
      },
    });
    const blocks = order(html, [
      "§footer.copyright",
      'class="fk-theme-form"',
      'aria-label="§footer.nav.label"',
      "<address>",
      "§footer.powered",
    ]);
    expect(blocks).toEqual(ascending(blocks));
    const groups = order(html, [
      'href="/en/catalog"',
      'href="/en/legal/privacy"',
      'href="/en/faq"',
    ]);
    expect(groups).toEqual(ascending(groups));
    expect(html.match(/<nav/g)).toHaveLength(1);
    expect(html.match(/<ul>/g)).toHaveLength(3);
    expect(html.endsWith("<p>§footer.powered</p></div></footer>")).toBe(true);
  });

  it("leaves out unlisted blocks, empty groups, and the navigation when no group has a link", () => {
    const html = footer(
      { blocks: ["copyright", "navigation"], navigation: { groups: [{ kind: "shopPages" }] } },
      [],
      false,
    );
    expect(html).not.toContain("<nav");
    expect(html).not.toContain("<ul");
    expect(html).not.toContain("<address");
    expect(html).not.toContain("fk-theme-form");
    expect(html).toContain("§footer.copyright");
    expect(html).toContain("§footer.powered");
  });

  it("keeps every text a message (the phone is the shop's data)", () => {
    const html = footer({
      blocks: ["navigation", "copyright", "themeSwitch"],
      navigation: { groups: [{ kind: "legal" }, { kind: "shopPages" }] },
    });
    expect(leftoverText(html)).toBe("");
    for (const value of textAttributes(html)) expect(value.startsWith("§"), value).toBe(true);
  });

  it("renders text lines from messages in their place and a heading above a link group, a heading only where configured", () => {
    const html = footer({
      blocks: [
        "navigation",
        { kind: "text", textKey: "footer.nav.label" },
        "themeSwitch",
        "copyright",
      ],
      navigation: {
        groups: [{ kind: "legal", headingKey: "legal.privacy.title" }, { kind: "shopPages" }],
      },
    });
    expect(html).toMatch(
      /<nav aria-label="§footer\.nav\.label"><h2 class="[^"]*text-sm[^"]*px-2">§legal\.privacy\.title<\/h2><ul><li><a href="\/en\/legal\/privacy">/,
    );
    expect(html.match(/<h2/g)).toHaveLength(1);
    expect(html).toContain("</nav><p>§footer.nav.label</p><form");
    expect(() => footer({ blocks: ["copyright"], navigation: { groups: [] } })).toThrow(
      /config\/footer\.ts is invalid: footer block "themeSwitch" is missing/,
    );
  });
});
