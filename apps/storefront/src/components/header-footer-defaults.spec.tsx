// TEMPLATE-DEFAULT CHECK (plan 2026-11-08-design-changeability.md, L3): this file pins the template's DEFAULT header and footer
// markup byte for byte. A client fork that edits `config/header.ts`, `config/footer.ts` or `config/brand.ts` deletes this file
// (`docs/customization.md`); it is left out of the fork run (`vitest.brand-fork.config.ts`), whose filled configs render other
// markup on purpose.
//
// The frozen files pin the WHOLE markup, @fluxkit/ui classes (`Container`) and the islands' markup included: an intended
// change there (a ui class, a header island) needs them regenerated, after checking the diff is the intended one:
//   pnpm --filter @fluxkit/storefront exec vitest run src/components/header-footer-defaults.spec.tsx -u
// A change to the header or footer composition itself must NOT be regenerated away: defaults stay byte for byte.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Locale } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { messagesByLocale } from "../messages";
import { contactsView } from "../lib/contacts";
import { I18nProvider } from "./i18n-provider";
import { SessionProvider } from "./session-provider";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { sentinelTranslator } from "./test-helpers";

/** The page the islands think they are on: `/<locale>/catalog?page=2` (the language links keep path and query). */
const route = vi.hoisted(() => ({ locale: "uk" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => `/${route.locale}/catalog`,
  useSearchParams: () => new URLSearchParams("page=2"),
}));

const t = sentinelTranslator();
const sentinelMessages = Object.fromEntries(
  Object.keys(messagesByLocale.uk).map((key) => [key, `§${key}`]),
);
/** Seven categories: one more than the default limit of six. */
const categories = Array.from({ length: 7 }, (_, index) => ({
  slug: index === 1 ? "a b/c" : `category-${String(index)}`,
  name: `§category-${String(index)}`,
}));
/** Explicit shop links and contacts: this file freezes the composition, not `config/shop-pages.ts` or `config/contacts.ts`. */
const shopLinks = [
  { labelKey: "shopPages.about.title", href: "/about" },
  { labelKey: "shopPages.contacts.title", href: "/contacts" },
];
const contacts = contactsView({
  phones: [{ tel: "+380441234567", display: "+380 44 123 45 67" }],
  email: "hello@example.com",
  addressKey: null,
  hoursKey: null,
  links: [],
  mapHref: null,
});

/** uk: categories over the limit, search box on, light theme; en: no categories (API down), no search box, system theme. */
const cases = {
  uk: { categories, searchEnabled: true, themeMode: "light" },
  en: { categories: null, searchEnabled: false, themeMode: "system" },
} as const;

function renderFrame(locale: Locale): { header: string; footer: string } {
  const frame = cases[locale];
  route.locale = locale;
  const html = renderToStaticMarkup(
    <I18nProvider locale={locale} messages={sentinelMessages}>
      <SessionProvider locale={locale}>
        <SiteHeader
          locale={locale}
          t={t}
          categories={frame.categories}
          searchEnabled={frame.searchEnabled}
        />
        <SiteFooter
          locale={locale}
          t={t}
          year={2026}
          themeMode={frame.themeMode}
          showThemeSwitch
          shopLinks={shopLinks}
          contacts={contacts}
        />
      </SessionProvider>
    </I18nProvider>,
  );
  const footerStart = html.indexOf("<footer");
  return { header: html.slice(0, footerStart), footer: html.slice(footerStart) };
}

describe("default header and footer markup (frozen before the L3 config, byte for byte)", () => {
  for (const locale of ["uk", "en"] as const) {
    it(`renders the frozen header and footer in ${locale}`, async () => {
      const { header, footer } = renderFrame(locale);
      expect(header.startsWith("<header")).toBe(true);
      expect(footer.endsWith("</footer>")).toBe(true);
      // `toMatchFileSnapshot` would quietly write a missing file outside CI: a deleted frozen file must fail here instead.
      for (const name of [`header.${locale}.txt`, `footer.${locale}.txt`]) {
        expect(existsSync(join(import.meta.dirname, "header-footer-defaults", name)), name).toBe(
          true,
        );
      }
      // Exact file contents (plus one newline at the end): a different file fails.
      await expect(`${header}\n`).toMatchFileSnapshot(
        `header-footer-defaults/header.${locale}.txt`,
      );
      await expect(`${footer}\n`).toMatchFileSnapshot(
        `header-footer-defaults/footer.${locale}.txt`,
      );
    });
  }
});
