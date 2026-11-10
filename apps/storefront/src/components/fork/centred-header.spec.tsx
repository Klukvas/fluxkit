import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { headerConfigProblems, type HeaderConfig } from "../../layout/header-layout";
import { messagesByLocale } from "../../messages";
import { headerConfig as templateHeader } from "../../test-support/template-defaults";
import { I18nProvider } from "../i18n-provider";
import { SessionProvider } from "../session-provider";
import { SiteHeader } from "../site-header";
import { leftoverText, sentinelTranslator } from "../test-helpers";
import { AnnouncementBar } from "./announcement-bar";

// FORK spec (reshape R3): the centred header of CORE-EDIT R3 (`layout: "centred"`) and the announcement bar. The header is
// rendered with an explicit config and empty slots, so it does not depend on what `config/header.ts` or `config/slots.tsx` hold.
vi.mock("../../config/slots", () => import("../../test-support/template-defaults"));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/en",
  useSearchParams: () => new URLSearchParams(),
}));

const t = sentinelTranslator();
const sentinelMessages = Object.fromEntries(
  Object.keys(messagesByLocale.en).map((key) => [key, `§${key}`]),
);
const categories = ["a", "b", "c", "d"].map((slug) => ({ slug, name: `§cat-${slug}` }));
const centred: HeaderConfig = { ...templateHeader, layout: "centred" };

function header(config: HeaderConfig, shown = categories, searchEnabled = true): string {
  return renderToStaticMarkup(
    <I18nProvider locale="en" messages={sentinelMessages}>
      <SessionProvider locale="en">
        <SiteHeader
          locale="en"
          t={t}
          categories={shown}
          searchEnabled={searchEnabled}
          config={config}
        />
      </SessionProvider>
    </I18nProvider>,
  );
}

describe("the centred header (fork, CORE-EDIT R3)", () => {
  it("leaves the template's row untouched without the layout, or with `row`", () => {
    expect(header({ ...templateHeader, layout: "row" })).toBe(header(templateHeader));
    expect(header(templateHeader)).not.toContain("fk-header-centred");
  });

  it("splits the inline navigation around the logo: the first half before it, the second after it, then the controls and the search row", () => {
    const html = header(centred);
    expect(html).toContain('fk-header-row fk-header-centred"');
    const order = [
      'class="fk-header-side fk-header-side-start"',
      'aria-label="§nav.menu"', // the menu button (below `xl`)
      'aria-label="§nav.main.label" class="hidden',
      "/en/c/c", // five links: three before the logo
      'class="fk-logo"',
      'class="fk-header-side"',
      'aria-label="§custom.header.navigationMore"',
      "/en/c/d",
      'class="fk-header-end"',
      'id="site-search"',
    ].map((part) => html.lastIndexOf(part));
    expect(order).not.toContain(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(leftoverText(html)).toBe("");
  });

  it("gives the two inline navigations different names and keeps every link in the menu", () => {
    const html = header(centred);
    const inline = [...html.matchAll(/<nav aria-label="([^"]*)" class="hidden/g)].map((m) => m[1]);
    expect(inline).toEqual(["§nav.main.label", "§custom.header.navigationMore"]);
    const menu = html.slice(html.indexOf("<details"), html.indexOf("</details>"));
    expect(menu.match(/<li>/g)).toHaveLength(5);
  });

  it("renders one inline navigation for a single link, none without links, and no search row while search is off", () => {
    const one = header(centred, []);
    expect(one.match(/<nav aria-label="[^"]*" class="hidden/g)).toHaveLength(1);
    expect(one).not.toContain("§custom.header.navigationMore");
    const none = header({ ...centred, navigation: { categoryLimit: 0, links: [] } });
    expect(none).not.toContain("§nav.main.label");
    expect(none).not.toContain("fk-header-nav");
    expect(none).toContain('class="fk-logo"');
    expect(header(centred, categories, false)).not.toContain('id="site-search"');
  });

  it("refuses a layout that does not exist", () => {
    expect(headerConfigProblems(centred, null)).toEqual([]);
    expect(
      headerConfigProblems({ ...centred, layout: "stacked" } as unknown as HeaderConfig, null),
    ).toEqual(["header layout must be one of row, centred"]);
  });
});

describe("AnnouncementBar (fork, reshape R3)", () => {
  const bar = (config: Parameters<typeof AnnouncementBar>[0]["config"]) =>
    renderToStaticMarkup(<AnnouncementBar locale="uk" t={t} config={config} />);

  it("shows the configured text and a localized link on its own opaque surface", () => {
    const html = bar({
      enabled: true,
      textKey: "custom.announcement.text",
      link: { labelKey: "custom.announcement.link", href: "/delivery-and-payment" },
    });
    expect(html).toMatch(/^<div data-announcement-bar="" class="bg-primary text-primary-foreground">/);
    expect(html).toContain("§custom.announcement.text");
    expect(html).toMatch(/href="\/uk\/delivery-and-payment"[^>]*>§custom\.announcement\.link</);
    expect(leftoverText(html)).toBe("");
  });

  it("renders nothing while disabled, and no link for a missing or external target", () => {
    expect(bar({ enabled: false, textKey: "custom.announcement.text", link: null })).toBe("");
    expect(bar({ enabled: true, textKey: "custom.announcement.text", link: null })).not.toContain("<a");
    expect(
      bar({
        enabled: true,
        textKey: "custom.announcement.text",
        link: { labelKey: "custom.announcement.link", href: "https://example.com" },
      }),
    ).not.toContain("<a");
  });
});
