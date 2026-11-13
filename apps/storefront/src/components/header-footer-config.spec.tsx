import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { messagesByLocale } from "../messages";
import { contactsView } from "../lib/contacts";
import type { FooterConfig } from "../layout/footer-layout";
import type { HeaderConfig, NavigationCategory } from "../layout/header-layout";
import { I18nProvider } from "./i18n-provider";
import { SessionProvider } from "./session-provider";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { leftoverText, sentinelTranslator, textAttributes } from "./test-helpers";

// Independent of the UI slots a fork fills in `config/slots.tsx` (plan S1): this spec checks what the header and footer configs
// render. Where the slots render, and that empty slots add nothing, is `slot-places.spec.tsx`; filled slots, the fork run.
vi.mock("../config/slots", () => import("../test-support/template-defaults"));

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

function header(
  config: HeaderConfig,
  searchEnabled = true,
  navigationCategories: readonly NavigationCategory[] = categories,
): string {
  return renderToStaticMarkup(
    <I18nProvider locale="en" messages={sentinelMessages}>
      <SessionProvider locale="en">
        <SiteHeader
          locale="en"
          t={t}
          categories={navigationCategories}
          searchEnabled={searchEnabled}
          themeMode="light"
          showThemeSwitch
          config={config}
        />
      </SessionProvider>
    </I18nProvider>,
  );
}

/** `themeInHeader` false: the footer's own theme switch checks run as for a header without the `theme` control. */
function footer(
  config: FooterConfig,
  shopLinks = [{ labelKey: "shopPages.faq.title", href: "/faq" }],
  showThemeSwitch = true,
  themeInHeader = false,
) {
  return renderToStaticMarkup(
    <SiteFooter
      locale="en"
      t={t}
      year={2026}
      themeMode="light"
      showThemeSwitch={showThemeSwitch}
      themeInHeader={themeInHeader}
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
      blocks: ["menu", "search", "logo", "navigation", "controls"],
      controls: ["account", "cart", "language"],
      navigation: { categoryLimit: 6, links: [] },
    });
    const blocks = order(html, [
      markers.menu,
      markers.search,
      markers.logo,
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

  it("opens the menu's panel towards the end as the first block on a phone and towards the start as the last; the controls' panels always towards the start", () => {
    const panelOf = (html: string, marker: string) =>
      /class="fk-menu-panel (start|end)-0/.exec(html.slice(html.indexOf(marker)))?.[1];
    const navigation = { categoryLimit: 2, links: [] };
    const orders: [HeaderConfig["blocks"], "start" | "end"][] = [
      [["menu", "logo", "navigation", "search", "controls"], "start"],
      [["navigation", "menu", "search", "logo", "controls"], "start"],
      [["logo", "search", "menu", "navigation"], "end"],
      [["search", "logo", "navigation", "menu"], "end"],
    ];
    for (const [blocks, expected] of orders) {
      const withControls = blocks.includes("controls");
      const html = header({
        blocks,
        controls: withControls ? ["language", "account", "cart"] : [],
        navigation,
      });
      expect(panelOf(html, markers.menu), blocks.join()).toBe(expected);
      if (withControls) expect(panelOf(html, markers.language), blocks.join()).toBe("end");
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
      blocks: ["navigation", "menu", "search", "logo", "controls"],
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
      /<nav aria-label="§footer\.nav\.label"><h2 class="[^"]*text-sm[^"]*">§legal\.privacy\.title<\/h2><ul><li><a href="\/en\/legal\/privacy">/,
    );
    // No start padding: the lists cancel their links' `px-2` (`-ms-2` in globals.css), so the heading and the link text line up.
    expect(html).not.toMatch(/<h2 class="[^"]*\bpx-2\b/);
    expect(html.match(/<h2/g)).toHaveLength(1);
    expect(html).toContain("</nav><p>§footer.nav.label</p><form");
    expect(() => footer({ blocks: ["copyright"], navigation: { groups: [] } })).toThrow(
      /config\/footer\.ts is invalid: footer block "themeSwitch" is missing/,
    );
  });
});

describe("SiteHeader: the picker display and the theme control (round 4)", () => {
  const tree: NavigationCategory[] = [
    {
      slug: "shoes",
      name: "§cat-shoes",
      children: [
        { slug: "boots", name: "§cat-boots" },
        { slug: "sandals", name: "§cat-sandals" },
      ],
    },
    { slug: "hats", name: "§cat-hats" },
  ];
  const picker: HeaderConfig = {
    blocks: ["menu", "logo", "navigation", "search", "controls"],
    controls: ["language", "theme", "cart", "account"],
    navigation: {
      display: "picker",
      categoryLimit: 6,
      links: [{ labelKey: "nav.catalog", href: "/catalog" }],
    },
  };

  it("renders the category list once, in one disclosure named by its visible text, with the children nested", () => {
    const html = header(picker, true, tree);
    expect(html.match(/§cat-shoes/g)).toHaveLength(1);
    expect(html.match(/§cat-boots/g)).toHaveLength(1);
    expect(html.match(/<nav aria-label="§nav\.main\.label"/g)).toHaveLength(1);
    expect(html).not.toContain(markers.navigation);
    // No aria-label on the summary: "Menu" (visually hidden, below `xl`) or "Categories" (from `xl`) names it.
    expect(html).toMatch(
      /<details class="group relative shrink-0"><summary role="button" aria-expanded="false" class="fk-header-button">.*?<span class="sr-only xl:hidden">§nav\.menu<\/span><span class="max-xl:hidden">§nav\.categories<\/span>/,
    );
    expect(html).toContain(
      '<ul class="fk-picker"><li><a class="fk-menu-item" href="/en/c/shoes">§cat-shoes</a><ul><li><a class="fk-menu-item" href="/en/c/boots">§cat-boots</a></li>',
    );
    expect(html).toContain(
      '<ul class="fk-picker-links"><li><a class="fk-menu-item" href="/en/catalog">§nav.catalog</a></li></ul>',
    );
    expect(html).not.toContain('role="menu');
  });

  it("renders the theme control with both icons and the no-script form, and its phone copy in the menu's panel", () => {
    const html = header(picker, true, tree);
    const control = html.slice(html.indexOf('aria-label="§theme.label"'));
    expect(html).toMatch(
      /<details class="group relative max-sm:hidden"><summary role="button" aria-expanded="false" aria-label="§theme\.label"/,
    );
    expect(control).toMatch(/class="fk-icon fk-light-only".*class="fk-icon fk-dark-only"/);
    expect(control).toContain('<form class="fk-theme-menu" action="/theme" method="post">');
    expect(control.match(/class="fk-theme-item"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(control).toContain(
      'value="light" aria-pressed="true" class="fk-theme-item" name="mode">§theme.light</button>',
    );
    // Two forms in all: the control's and the copy in the menu's panel (`sm:hidden`).
    expect(html.match(/action="\/theme"/g)).toHaveLength(2);
    expect(html.indexOf('class="fk-menu-theme"')).toBeLessThan(html.indexOf("fk-header-end"));
  });

  it("keeps the theme control on a phone when the header has no menu", () => {
    const html = header({ ...picker, blocks: ["logo", "search", "controls"] }, true, tree);
    expect(html).toMatch(
      /<details class="group relative "><summary role="button" aria-expanded="false" aria-label="§theme\.label"/,
    );
    expect(html).not.toContain("fk-menu-theme");
    expect(html.match(/action="\/theme"/g)).toHaveLength(1);
  });

  it("keeps every text a message", () => {
    const html = header(picker, true, tree);
    expect(leftoverText(html)).toBe("");
    for (const value of textAttributes(html)) expect(value.startsWith("§"), value).toBe(true);
  });
});

describe("SiteFooter: the columns layout (round 4)", () => {
  const columns: FooterConfig = {
    layout: "columns",
    blocks: ["navigation", { kind: "text", textKey: "site.description" }, "contacts", "copyright"],
    navigation: {
      groups: [
        { kind: "shopPages" },
        { kind: "legal" },
        {
          kind: "links",
          headingKey: "footer.nav.label",
          links: [{ labelKey: "nav.catalog", href: "/catalog" }],
        },
      ],
    },
  };
  const noContacts = contactsView({
    phones: [],
    email: null,
    addressKey: null,
    hoursKey: null,
    links: [],
    mapHref: null,
  });

  it("makes each link group a navigation named by its visible heading, the contacts a column, the rest a bottom row", () => {
    const html = footer(columns, undefined, true, true);
    expect(html).toContain(
      '<div class="fk-footer-grid"><nav aria-labelledby="footer-group-1"><h2 id="footer-group-1">§footer.group.shop</h2><ul><li><a href="/en/faq">',
    );
    expect(html).toContain(
      '<nav aria-labelledby="footer-group-2"><h2 id="footer-group-2">§footer.group.legal</h2>',
    );
    expect(html).toContain(
      '<nav aria-labelledby="footer-group-3"><h2 id="footer-group-3">§footer.nav.label</h2>',
    );
    expect(html).toContain("<div><h2>§footer.group.contacts</h2><address>");
    expect(html).toContain(
      '<div class="fk-footer-bottom"><p>§site.description</p><p>§footer.copyright</p><p>§footer.powered</p></div>',
    );
    expect(html).not.toContain("fk-theme-form");
    expect(html.match(/<nav/g)).toHaveLength(3);
  });

  it("leaves out the grid with no column, and the contacts column without a phone or an email", () => {
    const html = renderToStaticMarkup(
      <SiteFooter
        locale="en"
        t={t}
        year={2026}
        themeMode="light"
        showThemeSwitch
        themeInHeader
        shopLinks={[]}
        contacts={noContacts}
        config={{
          layout: "columns",
          blocks: ["contacts", "copyright"],
          navigation: { groups: [] },
        }}
      />,
    );
    expect(html).not.toContain("fk-footer-grid");
    expect(html).not.toContain("<h2");
    expect(html).toContain('<div class="fk-footer-bottom"><p>§footer.copyright</p>');
  });

  it("keeps a theme switch a fork still lists, in the bottom row", () => {
    const html = footer({ ...columns, blocks: [...columns.blocks, "themeSwitch"] });
    expect(html.indexOf("fk-footer-bottom")).toBeLessThan(html.indexOf('class="fk-theme-form"'));
  });

  it("refuses an own group without a heading at render", () => {
    const own = { kind: "links", links: [{ labelKey: "nav.catalog", href: "/catalog" }] } as const;
    expect(() =>
      footer({ ...columns, navigation: { groups: [own] } }, undefined, true, true),
    ).toThrow(/needs a headingKey in the columns layout/);
  });

  it("keeps every text a message (the phone is the shop's data)", () => {
    const html = footer(columns, undefined, true, true);
    expect(leftoverText(html.replace(/<address>.*?<\/address>/, ""))).toBe("");
    for (const value of textAttributes(html)) expect(value.startsWith("§"), value).toBe(true);
  });
});
