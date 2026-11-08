import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTranslator, locales } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import uk from "../messages/uk.json";
import { HEADER_CATEGORY_LIMIT, MAIN_CONTENT_ID } from "../layout/navigation";
import { AccountLinkView, SignOutItemView } from "./account-link";
import { CartBadgeView } from "./cart-badge";
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
      themeMode="light"
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
    // main (twice: inside the menu below `lg`, inline from `lg`; one is always display:none), its second half beside the
    // icons (reshape experiment), locale switcher, footer
    expect(navs).toHaveLength(5);
    for (const nav of navs) expect(nav).toMatch(/aria-label="§[^"]+"/);
    const mains = navs.filter((nav) => nav.includes('aria-label="§nav.main.label"'));
    expect(mains).toHaveLength(2);
    expect(html).toMatch(
      /<details class="[^"]*lg:hidden[^"]*"><summary role="button" aria-expanded="false" aria-label="§nav\.menu"/,
    );
    expect(html).toMatch(/<nav aria-label="§nav\.main\.label" class="fk-nav-start/);
    expect(html).toMatch(/<nav aria-label="§nav\.more\.label" class="fk-nav-split/);
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
        themeMode="light"
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
    // The footer's phone and email are the shop's data from `config/contacts.ts` (repair batch 2), not words.
    const withoutContacts = html.replace(/<address>.*?<\/address>/, "");
    expect(withoutContacts).not.toBe(html);
    expect(leftoverText(withoutContacts)).toBe("");
    for (const value of textAttributes(html)) expect(value.startsWith("§"), value).toBe(true);
  });

  it("shows the copyright with year and name placeholders through the translator", () => {
    expect(html).toContain("§footer.copyright");
    expect(html).toContain("§footer.powered");
  });
});

describe("header size (it is in every page's first HTML)", () => {
  it("stays small, so the sign-in and registration forms still render before their script runs", () => {
    // React 19.3 moves a finished page section out of place (to be put back by a script) once the HTML before it plus the
    // section pass 12 800 bytes (`progressiveChunkSize`); the e2e `pre-hydration-forms` test then sees only the loading
    // view. The `<head>` counts too, and the loading view even when it is not sent. Measured 2026-11-05 with the real build
    // and the search box: uk header 5.4 KB and `/uk/account/register` outlined (e2e uk failed); 4.8 KB after more single
    // classes (`.fk-header-row` and others) and inline (README, "Keep the header small").
    const longNames = Array.from({ length: HEADER_CATEGORY_LIMIT }, (_, index) => ({
      slug: `category-${String(index)}`,
      name: `§Category name ${String(index)}`,
    }));
    const html = renderToStaticMarkup(
      <SiteShell
        themeMode="light"
        locale="uk"
        messages={sentinelMessages}
        t={t}
        categories={longNames}
        searchEnabled={false}
        year={2026}
      >
        §child
      </SiteShell>,
    );
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(new TextEncoder().encode(header).length).toBeLessThan(3700); // 3 427 bytes on 2026-11-05 (six categories, no search box; 3 802 on 2026-11-02)
  });

  it("keeps the footer small too: it is flushed with the shell, before a page section that streams later", () => {
    // Design batch B: the theme switch made the footer 2.3 KB and `/{locale}/account/register` was outlined again (e2e
    // `pre-hydration-forms`); with one class per link and button it is about 1.6 KB, and the forms render inline.
    const html = renderToStaticMarkup(
      <SiteShell
        themeMode="system"
        locale="uk"
        messages={sentinelMessages}
        t={t}
        categories={null}
        searchEnabled={false}
        year={2026}
      >
        §child
      </SiteShell>,
    );
    const footer = html.slice(html.indexOf("<footer"), html.indexOf("</footer>"));
    expect(footer).toContain('class="fk-theme-option"');
    // 1 261 bytes on 2026-11-05; 1 372 on 2026-11-06 with the shop pages and the contacts (1 377 with the `<br>` between phone and email, review m8 of PR 232) (repair batch 2): the lists, links and
    // contacts carry no class, and catalog, cart and account (all in the header) left the footer.
    expect(new TextEncoder().encode(footer).length).toBeLessThan(1400);
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
      // The 44 px slot (`.fk-header-button`: min-h-11 min-w-11 in app/globals.css) in every state.
      expect(html).toContain(`class="fk-header-button"`);
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
    for (const html of [guest, signedIn]) expect(html).toContain(`class="fk-header-button"`);
    // The same 44 x 44 slot as the control that replaces it (`.fk-header-slot`, checked in `globals-css.spec.ts`).
    expect(loading).toContain('class="fk-header-slot ');
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
    expect(html).toMatch(/<span aria-hidden="true" class="fk-flag fk-flag-ua"><\/span>/);
    expect(html).toMatch(/<span aria-hidden="true" class="fk-flag fk-flag-gb"><\/span>/);
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
