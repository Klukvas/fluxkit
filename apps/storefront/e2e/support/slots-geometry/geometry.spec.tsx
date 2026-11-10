// LOCAL geometry probe of the UI slots' fork fixture; see `vitest.config.ts` next to this file for why and how to run it.
import { chromium, type Browser } from "@playwright/test";
import { createTranslator, Container, type Locale } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import css from "../../../src/app/globals.css?inline";
import { I18nProvider } from "../../../src/components/i18n-provider";
import { ProductGrid } from "../../../src/components/product-grid";
import { SiteFooter } from "../../../src/components/site-footer";
import type { FooterConfig } from "../../../src/layout/footer-layout";
import { contactsView } from "../../../src/lib/contacts";
import { summary } from "../../../src/lib/test-fixtures";
import { messagesByLocale } from "../../../src/messages";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/uk",
  useSearchParams: () => new URLSearchParams(),
}));

/** The fork's `config/footer.ts` of a four-column footer: navigation and contacts live in the slot's columns. */
const fourColumnFooter: FooterConfig = {
  blocks: ["themeSwitch", "copyright"],
  navigation: { groups: [{ kind: "shopPages" }, { kind: "legal" }] },
};

function page(body: string): string {
  return `<!doctype html><html lang="uk" data-theme="light"><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`;
}

function cards(locale: Locale): string {
  const t = createTranslator(messagesByLocale[locale], locale);
  const products = [
    summary("a", { title: "Чайник електричний зі скляною колбою та підсвіткою" }, "low_stock"),
    summary("b", { title: "Кавомолка" }, "out_of_stock"),
    summary("c", { title: "Френч-прес на 1 літр" }, "low_stock"),
    summary("d", { title: "Турка мідна" }, "in_stock"),
  ];
  return renderToStaticMarkup(
    <Container>
      <ProductGrid
        products={products}
        locale={locale}
        t={t}
        exponent={2}
        imageHosts={[]}
        headingLevel="h2"
        brandPathFor={(slug) => `/catalog?brand=${slug}`}
        label="list"
      />
    </Container>,
  );
}

function footer(locale: Locale): string {
  const messages = messagesByLocale[locale];
  const t = createTranslator(messages, locale);
  return renderToStaticMarkup(
    <I18nProvider locale={locale} messages={messages}>
      <SiteFooter
        locale={locale}
        t={t}
        year={2026}
        themeMode="light"
        showThemeSwitch
        config={fourColumnFooter}
        contacts={contactsView({
          phones: [{ tel: "+380441234567", display: "+380 44 123 45 67" }],
          email: "hello@example.com",
          addressKey: null,
          hoursKey: null,
          links: [],
          mapHref: null,
        })}
      />
    </I18nProvider>,
  );
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The area two boxes share (0 when they do not meet). */
function overlap(a: Box, b: Box): number {
  return (
    Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  );
}

let browser: Browser;
beforeAll(async () => {
  // The real stylesheet, compiled: the footer rules, the slot frames and the fixture's classes are in it.
  for (const rule of [
    ".fk-site-footer",
    "lg\\:grid-cols-4",
    ".whitespace-normal",
    ".bottom-2",
    "--fk-color-primary",
  ]) {
    expect(css, rule).toContain(rule);
  }
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});

describe("grid card: the actions frame never covers the availability badge", () => {
  for (const width of [320, 375, 1280]) {
    it(`at ${String(width)} px`, async () => {
      const tab = await browser.newPage({ viewport: { width, height: 900 } });
      await tab.setContent(page(cards("uk")));
      const result = await tab.evaluate(() =>
        [...document.querySelectorAll("article")].map((article) => {
          const box = (element: Element | null) => element?.getBoundingClientRect() ?? null;
          const badge = box(article.querySelector(".left-5"));
          const actions = box(article.querySelector(".bottom-2"));
          const image = box(article.querySelector(".bottom-2")?.parentElement ?? null);
          const plain = (rect: DOMRect | null): Box | null =>
            rect && { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
          return { badge: plain(badge), actions: plain(actions), image: plain(image) };
        }),
      );
      await tab.close();
      expect(result).toHaveLength(4);
      for (const { badge, actions, image } of result) {
        if (actions === null || image === null) throw new Error("no actions frame on a card");
        // Inside the image.
        expect(
          actions.left >= image.left &&
            actions.top >= image.top &&
            actions.right <= image.right &&
            actions.bottom <= image.bottom,
          JSON.stringify({ actions, image }),
        ).toBe(true);
        if (badge === null) continue;
        expect(overlap(badge, actions), JSON.stringify({ badge, actions })).toBe(0);
      }
    });
  }
});

describe("four-column footer: no link overflows its column, no column overlaps another", () => {
  for (const locale of ["uk", "en"] as const) {
    for (const width of [640, 1024, 1280]) {
      it(`${locale} at ${String(width)} px`, async () => {
        const tab = await browser.newPage({ viewport: { width, height: 900 } });
        await tab.setContent(page(footer(locale)));
        const result = await tab.evaluate(() => {
          const grid = document.querySelector("footer .grid");
          const columns = [...(grid?.children ?? [])].map((column) => {
            const rect = column.getBoundingClientRect();
            const overflow = [...column.querySelectorAll("a, h2, p, address")].map((element) => {
              const box = element.getBoundingClientRect();
              return {
                text: element.textContent,
                past: Math.max(0, box.right - rect.right),
                clipped: Math.max(0, element.scrollWidth - element.clientWidth),
              };
            });
            const box: Box = {
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
            };
            return { box, overflow };
          });
          return {
            count: columns.length,
            columns,
            pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
          };
        });
        await tab.close();
        expect(result.count).toBe(4);
        expect(result.pageOverflow).toBeLessThanOrEqual(0);
        for (const column of result.columns) {
          for (const item of column.overflow) {
            expect(item.past, `${String(item.text)} past its column`).toBeLessThanOrEqual(0.5);
            expect(item.clipped, `${String(item.text)} clipped`).toBe(0);
          }
        }
        result.columns.forEach((a, i) =>
          result.columns.slice(i + 1).forEach((b) => {
            expect(overlap(a.box, b.box)).toBe(0);
          }),
        );
      });
    }
  }
});
