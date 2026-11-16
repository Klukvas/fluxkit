import { createTranslator, type Locale } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { demoNoticeUrls } from "../config/demo-notice";
import { pickClientMessages } from "../lib/client-messages";
import { messagesByLocale } from "../messages";
import { DemoNotice } from "./demo-notice";
import { DemoNoticeDialog } from "./demo-notice-dialog";
import { I18nProvider } from "./i18n-provider";
import { SiteShell } from "./site-shell";
import { findElements, leftoverText, sentinelTranslator } from "./test-helpers";

vi.mock("../config/slots", () => import("../test-support/template-defaults"));
vi.mock("../config/header", () => import("../test-support/template-defaults"));
vi.mock("../config/footer", () => import("../test-support/template-defaults"));

function shell(locale: Locale, demoNotice?: boolean) {
  return SiteShell({
    locale,
    messages: messagesByLocale[locale],
    t: createTranslator(messagesByLocale[locale], locale),
    categories: [],
    searchEnabled: false,
    themeMode: "light",
    year: 2026,
    children: null,
    ...(demoNotice === undefined ? {} : { demoNotice }),
  });
}

describe("demo notice in the page frame", () => {
  it.each(["uk", "en"] as const)(
    "renders the %s strip before the header, with the skip link first",
    (locale) => {
      const t = createTranslator(messagesByLocale[locale], locale);
      const html = renderToStaticMarkup(shell(locale, true));
      expect(html.startsWith('<a href="#main-content"')).toBe(true);
      expect(html.indexOf(t("demo.strip"))).toBeLessThan(html.indexOf("<header"));
      expect(html).toContain(t("demo.stripLink"));
      const url = new URL(demoNoticeUrls[locale]);
      expect(url.origin).toBe("https://flux-lab.dev");
      expect(url.pathname).toBe(`/${locale}`);
      expect([...url.searchParams]).toEqual([
        ["utm_source", "fluxkit-demo"],
        ["utm_medium", "demo-notice"],
      ]);
      const link = html.match(/<a[^>]*href="https:\/\/flux-lab\.dev[^>]*>/)?.[0];
      expect(link).toContain('target="_blank"');
      expect(link).toContain('rel="noopener noreferrer"');
      // The first response and hydration agree: opening happens in an effect, never through the HTML attribute.
      expect(html).toContain("<dialog");
      expect(html).not.toMatch(/<dialog[^>]*\bopen[=> ]/);
    },
  );

  it.each([undefined, false])(
    "renders and mounts no demo UI when off (%j), without touching storage",
    (flag) => {
      const readStorage = vi.fn(() => {
        throw new Error("must not read storage");
      });
      vi.stubGlobal("window", {
        get localStorage() {
          return readStorage();
        },
      });
      try {
        const tree = shell("en", flag);
        expect(findElements(tree, (element) => element.type === DemoNoticeDialog)).toHaveLength(0);
        const html = renderToStaticMarkup(tree);
        expect(html).not.toContain("flux-lab.dev/en?utm_");
        expect(html).not.toContain(messagesByLocale.en["demo.strip"]);
        expect(html).not.toContain("<dialog");
        expect(readStorage).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it("uses only translated words and passes every demo key through the client message picker", () => {
    expect(
      leftoverText(renderToStaticMarkup(<DemoNotice locale="uk" t={sentinelTranslator()} />)),
    ).toBe("");
    for (const locale of ["uk", "en"] as const) {
      const messages = pickClientMessages(messagesByLocale[locale]);
      for (const [key, value] of Object.entries(messagesByLocale[locale]).filter(([key]) =>
        key.startsWith("demo."),
      )) {
        expect(messages[key], key).toBe(value);
      }
      const html = renderToStaticMarkup(
        <I18nProvider locale={locale} messages={messages}>
          <DemoNoticeDialog />
        </I18nProvider>,
      );
      for (const key of ["demo.title", "demo.body", "demo.cta", "demo.order", "demo.explore"]) {
        expect(html).toContain(messages[key]);
      }
    }
  });
});
