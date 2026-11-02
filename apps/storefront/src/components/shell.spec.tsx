import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTranslator, locales } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import uk from "../messages/uk.json";
import { homeSections } from "../layout/home";
import { MAIN_CONTENT_ID } from "../layout/navigation";
import { AccountLinkView, SignOutItemView } from "./account-link";
import { CartBadgeView } from "./cart-badge";
import { homeSectionRegistry, HomeSections } from "./home-sections";
import { LocaleSwitcherView } from "./locale-switcher";
import { SiteShell } from "./site-shell";
import { ErrorView, LoadingView, NotFoundView } from "./status-views";
import { customer } from "../lib/test-fixtures";
import { findElements, leftoverText, sentinelTranslator, textAttributes } from "./test-helpers";

const t = sentinelTranslator();
/** What the client islands read through the provider: every message is its own sentinel. */
const sentinelMessages = Object.fromEntries(Object.keys(uk).map((key) => [key, `§${key}`]));
const categories = [
  { slug: "shoes", name: "§cat-shoes" },
  { slug: "a b/c", name: "§cat-odd" },
];

function renderShell(children = "§child") {
  return renderToStaticMarkup(
    <SiteShell
      locale="uk"
      messages={sentinelMessages}
      t={t}
      categories={categories}
      searchEnabled={false}
      year={2026}
    >
      {children}
    </SiteShell>,
  );
}

describe("SiteShell landmarks and accessibility", () => {
  const html = renderShell();

  it("puts the skip link first, pointing at the main element", () => {
    expect(html.startsWith('<a href="#main-content"')).toBe(true);
    expect(html).toContain(`<main id="${MAIN_CONTENT_ID}" tabindex="-1"`);
    expect(MAIN_CONTENT_ID).toBe("main-content");
    expect(html).toContain("§skip.content");
    // The skip link is visible on focus only, by the ui component's own classes.
    expect(
      html.match(/<a [^>]*href="#main-content"[^>]*class="[^"]*focus:not-sr-only/),
    ).not.toBeNull();
  });

  it("has header, main and footer landmarks, once each, in order", () => {
    for (const tag of ["header", "main", "footer"]) {
      expect(html.match(new RegExp(`<${tag}[ >]`, "g"))?.length, tag).toBe(1);
    }
    expect(html.indexOf("<header")).toBeLessThan(html.indexOf("<main"));
    expect(html.indexOf("<main")).toBeLessThan(html.indexOf("<footer"));
  });

  it("labels every navigation landmark", () => {
    const navs = html.match(/<nav[^>]*>/g) ?? [];
    // main (twice: inside the menu below `xl`, inline from `xl`; one is always display:none), locale switcher, footer
    expect(navs).toHaveLength(4);
    for (const nav of navs) expect(nav).toMatch(/aria-label="§[^"]+"/);
    const mains = navs.filter((nav) => nav.includes('aria-label="§nav.main.label"'));
    expect(mains).toHaveLength(2);
    expect(html).toMatch(
      /<details class="[^"]*xl:hidden[^"]*"><summary role="button" aria-expanded="false" aria-label="§nav\.menu"/,
    );
    expect(html).toMatch(/<nav aria-label="§nav\.main\.label" class="hidden[^"]*xl:block/);
    expect(html).toContain('aria-label="§nav.main.label"');
    expect(html).toContain('aria-label="§footer.nav.label"');
    expect(html).toContain('aria-label="§locale.switcher.label"');
  });

  it("links categories (slug encoded) before the configured links, and the logo to the locale's home", () => {
    expect(html).toContain('href="/uk/c/shoes"');
    expect(html).toContain('href="/uk/c/a%20b%2Fc"');
    expect(html.indexOf("§cat-shoes")).toBeLessThan(html.indexOf("§nav.catalog"));
    expect(html).toContain('<a class="');
    expect(html).toContain('href="/uk"');
  });

  it("renders without categories when the API could not be read", () => {
    const degraded = renderToStaticMarkup(
      <SiteShell
        locale="en"
        messages={sentinelMessages}
        t={t}
        categories={null}
        searchEnabled={false}
        year={2026}
      >
        §child
      </SiteShell>,
    );
    expect(degraded).toContain("§nav.catalog");
    expect(degraded).toContain('href="/en/catalog"');
    expect(degraded).toContain("<main");
  });

  it("contains no hardcoded user-facing text or attribute text", () => {
    expect(leftoverText(html)).toBe("");
    for (const value of textAttributes(html)) expect(value.startsWith("§"), value).toBe(true);
  });

  it("shows the copyright with year and name placeholders through the translator", () => {
    expect(html).toContain("§footer.copyright");
    expect(html).toContain("§footer.powered");
  });
});

describe("header islands", () => {
  it("shows the cart as an icon with a count badge only above 0, a spoken count, and a fixed slot (no layout shift)", () => {
    const slot = (state: Parameters<typeof CartBadgeView>[0]["state"]) =>
      renderToStaticMarkup(<CartBadgeView state={state} t={t} locale="uk" />);
    const loading = slot({ status: "loading" });
    const ready = slot({ status: "ready", count: 3 });
    const zero = slot({ status: "ready", count: 0 });
    const many = slot({ status: "ready", count: 150 });
    const failed = slot({ status: "error" });
    for (const html of [loading, ready, zero, failed, many]) {
      expect(html).toContain("min-h-11 min-w-11");
      expect(html).toContain('href="/uk/cart"');
      expect(html).toContain("§nav.cart");
      expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
      expect(html).toContain('aria-live="polite"');
    }
    const badge =
      /<span aria-hidden="true" class="[^"]*bg-danger[^"]*text-danger-foreground[^"]*">([^<]*)<\/span>/;
    expect(ready.match(badge)?.[1]).toBe("3");
    expect(zero).not.toMatch(badge);
    expect(zero).not.toContain("bg-danger");
    expect(loading).not.toContain("bg-danger");
    expect(failed).not.toContain("bg-danger");
    expect(many.match(badge)?.[1]).toBe("§nav.cart.overflow");
    expect(many).toContain("§nav.cart.items:150");
    expect(loading).toContain("§nav.cart.loading");
    expect(ready).toContain("§nav.cart.items:3");
    expect(zero).toContain("§nav.cart.items:0");
    expect(failed).not.toContain("§nav.cart.items");
    expect(failed).not.toContain("§nav.cart.loading");
    for (const html of [loading, ready, zero, failed]) expect(leftoverText(html)).toBe("");
  });

  it("gives the account icon a menu: sign in and register for a guest, the account pages and sign out for a customer", () => {
    const slot = (state: Parameters<typeof AccountLinkView>[0]["state"], signOut?: string) =>
      renderToStaticMarkup(
        <AccountLinkView state={state} t={t} locale="en" signOut={signOut ?? null} />,
      );
    const guest = slot({ status: "guest" });
    expect(guest).toMatch(
      /<details[^>]*><summary role="button" aria-expanded="false" aria-label="§nav\.account\.menu"/,
    );
    expect(guest).toContain('href="/en/account/login"');
    expect(guest).toContain("§nav.account.signIn");
    expect(guest).toContain('href="/en/account/register"');
    expect(guest).toContain("§nav.account.register");
    expect(guest).not.toContain('href="/en/account/orders"');
    const signedIn = slot({ status: "signedIn", customer: customer() }, "§sign-out-item");
    expect(signedIn).toMatch(
      /<summary role="button" aria-expanded="false" aria-label="§nav\.account\.named"/,
    );
    for (const [href, key] of [
      ["/en/account", "§nav.account.overview"],
      ["/en/account/orders", "§nav.account.orders"],
      ["/en/account/profile", "§nav.account.profile"],
      ["/en/account/data", "§nav.account.privacy"],
    ]) {
      expect(signedIn).toContain(`href="${href}"`);
      expect(signedIn).toContain(key);
    }
    expect(signedIn).toContain("§sign-out-item");
    expect(signedIn).not.toContain('href="/en/account/login"');
    expect(slot({ status: "error" })).toContain('href="/en/account"');
    expect(slot({ status: "error" })).toContain('aria-label="§nav.account.account"');
    const loading = slot({ status: "loading" });
    expect(loading).toContain("§nav.account.loading");
    expect(loading).not.toContain("<a ");
    expect(loading).not.toContain("<details");
    for (const html of [guest, signedIn, loading]) expect(html).toContain("min-h-11 min-w-11");
  });

  it("signs out from the account menu with a busy state and shows a failed sign-out as an alert", () => {
    const onLogout = vi.fn();
    const idle = SignOutItemView({ t, pending: false, failure: null, onLogout });
    const [button] = findElements(idle, (candidate) => candidate.type === "button");
    (button?.props.onClick as () => void)();
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(renderToStaticMarkup(idle)).toContain("§account.logout");
    const busy = renderToStaticMarkup(
      <SignOutItemView t={t} pending failure={null} onLogout={onLogout} />,
    );
    expect(busy).toMatch(/<button[^>]*disabled=""[^>]*aria-busy="true"/);
    expect(busy).toContain("§account.logout.pending");
    const failed = renderToStaticMarkup(
      <SignOutItemView
        t={t}
        pending={false}
        failure={{
          messageKey: "errors.network",
          status: null,
          code: null,
          retryAfterSeconds: null,
          fieldErrors: [],
        }}
        onLogout={onLogout}
      />,
    );
    expect(failed).toMatch(/role="alert"[^>]*>§errors\.network/);
  });

  it("shows the customer's first name as plain text, never as markup", () => {
    const real = createTranslator(en, "en");
    const hostile = customer({
      firstName: '<img src=x onerror="alert(1)"><script>alert(2)</script>',
    });
    const html = renderToStaticMarkup(
      <AccountLinkView state={{ status: "signedIn", customer: hostile }} t={real} locale="en" />,
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("truncate");
  });

  it("switches locale on the same page, keeps the query, marks the current locale", () => {
    const html = renderToStaticMarkup(
      <LocaleSwitcherView locale="uk" t={t} pathname="/uk/catalog" search="?page=2" />,
    );
    // A dropdown (owner request 2026-11-02): the summary is named "Site language: <name>", flags are decoration only.
    expect(html).toMatch(
      /<details[^>]*><summary role="button" aria-expanded="false" aria-label="§locale\.switcher\.current"/,
    );
    expect(html).toContain("§locale.short.uk");
    expect(html).toMatch(/<span aria-hidden="true" class="fk-flag fk-flag-ua rounded-sm ring-1 ring-border"><\/span>/);
    expect(html).toMatch(/<span aria-hidden="true" class="fk-flag fk-flag-gb rounded-sm ring-1 ring-border"><\/span>/);
    expect(html).toMatch(/<span lang="uk" aria-current="true"/);
    expect(html).toContain('href="/en/catalog?page=2"');
    expect(html).toContain('hrefLang="en"');
    expect(html).not.toContain('href="/uk/catalog');
    expect(html).toContain("§locale.name.uk");
    expect(html).toContain("§locale.name.en");
    expect(locales).toEqual(["uk", "en"]);
  });

  it("keeps the fragment of the page (the guest order token) in the other locale's link, after the query", () => {
    const html = renderToStaticMarkup(
      <LocaleSwitcherView
        locale="uk"
        t={t}
        pathname="/uk/order/7K3M-9QX2"
        search=""
        hash="#t=AbCdEfGhIjKlMnOpQrSt"
      />,
    );
    expect(html).toContain('href="/en/order/7K3M-9QX2#t=AbCdEfGhIjKlMnOpQrSt"');
  });

  it("renders no fragment on the server: the island reads location.hash only in the browser", () => {
    const island = readFileSync(join(import.meta.dirname, "locale-switcher.tsx"), "utf8");
    // The hash starts empty (server render and hydration) and is read inside an effect only.
    expect(island).toMatch(/useState\(""\)/);
    expect(island).toMatch(
      /useEffect\(\(\) => \{\s*const read = \(\) => setHash\(window\.location\.hash\)/,
    );
    expect(island.match(/window\.location\.hash/g)).toHaveLength(1);
  });
});

describe("home sections", () => {
  // No data: every data section shows its empty state (the filled sections are tested in catalog.spec.tsx).
  const home = renderToStaticMarkup(
    <HomeSections sections={homeSections} locale="uk" t={t} data={{}} imageHosts={[]} />,
  );

  it("renders the configured sections in order with a sound heading outline", () => {
    expect(home.match(/<h1[ >]/g)).toHaveLength(1);
    const headings = [...home.matchAll(/<h([1-3])[ >]/g)].map((match) => match[1]);
    expect(headings).toEqual(["1", "2", "3", "2", "3"]);
    expect(home.indexOf("§home.hero.title")).toBeLessThan(
      home.indexOf("§home.categoryTiles.title"),
    );
    expect(home.indexOf("§home.categoryTiles.title")).toBeLessThan(
      home.indexOf("§home.newProducts.title"),
    );
    expect(home).toContain('href="/uk/catalog"');
  });

  it("follows the configuration: reordering or removing a section changes the page", () => {
    const hero = homeSections.find((section) => section.type === "hero");
    const products = homeSections.find((section) => section.type === "newProducts");
    if (hero === undefined || products === undefined)
      throw new Error("The home config lost a section.");
    const reordered = renderToStaticMarkup(
      <HomeSections sections={[products, hero]} locale="uk" t={t} data={{}} imageHosts={[]} />,
    );
    expect(reordered).not.toContain("§home.categoryTiles.title");
    expect(reordered.indexOf("§home.newProducts.title")).toBeLessThan(
      reordered.indexOf("§home.hero.title"),
    );
  });

  it("has a renderer for every configured section type and refuses an unknown one", () => {
    for (const section of homeSections) {
      expect(typeof homeSectionRegistry[section.type]).toBe("function");
    }
    const unknown = { type: "carousel", props: {} } as never;
    expect(() =>
      renderToStaticMarkup(
        <HomeSections sections={[unknown]} locale="uk" t={t} data={{}} imageHosts={[]} />,
      ),
    ).toThrow(/carousel/);
  });

  it("has no hardcoded text", () => {
    expect(leftoverText(home)).toBe("");
    for (const value of textAttributes(home)) expect(value.startsWith("§"), value).toBe(true);
  });
});

describe("status views", () => {
  it("renders the error state with a retry button, a home link and the digest only", () => {
    let retried = false;
    const html = renderToStaticMarkup(
      <ErrorView t={t} digest="d123" homeHref="/uk" onRetry={() => (retried = true)} />,
    );
    expect(retried).toBe(false);
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toContain("§error.title");
    expect(html).toContain("§error.retry");
    expect(html).toContain('<button type="button"');
    expect(html).toContain('href="/uk"');
    expect(html).toContain("§error.reference");
    expect(leftoverText(html)).toBe("");
    expect(
      renderToStaticMarkup(
        <ErrorView t={t} digest={undefined} homeHref="/uk" onRetry={() => {}} />,
      ),
    ).not.toContain("§error.reference");
  });

  it("renders the not-found and loading states from messages", () => {
    const notFound = renderToStaticMarkup(<NotFoundView t={t} homeHref="/en" />);
    expect(notFound).toContain("§notFound.title");
    // Its own page title (the layout's generateMetadata title is the generic site title): React hoists <title> to the head.
    expect(notFound).toMatch(/<title>[^<]*§seo\.pageTitle[^<]*<\/title>/);
    expect(notFound).toContain('href="/en"');
    expect(leftoverText(notFound)).toBe("");
    const loading = renderToStaticMarkup(<LoadingView t={t} />);
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain('role="status"');
    expect(loading).toContain("§loading.page");
    expect(leftoverText(loading)).toBe("");
  });
});
