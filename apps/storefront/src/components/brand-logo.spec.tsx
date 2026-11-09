import { createTranslator } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { messagesByLocale } from "../messages";
import { BrandLogo } from "./brand-logo";

const t = createTranslator(messagesByLocale.uk, "uk");
const shopName = messagesByLocale.uk["site.name"] as string;
const light = { src: "/brand/logo.svg", width: 120, height: 32 } as const;
const dark = { src: "/brand/logo-dark.svg", width: 120, height: 32 } as const;

const images = (html: string) => html.match(/<img[^>]*>/g) ?? [];

describe("BrandLogo (config/brand.ts logo, plan B1)", () => {
  it("renders the text logo exactly as the header did before the brand config", () => {
    // The markup of `site-header.tsx` before PR-E2, byte for byte. The logo is passed explicitly: a fork's `config/brand.ts`
    // may hold an image logo, and this spec must stay green there (`vitest.brand-fork.config.ts`).
    expect(renderToStaticMarkup(<BrandLogo locale="uk" t={t} logo={{ kind: "text" }} />)).toBe(
      `<a title="${shopName}" class="fk-logo" href="/uk">${shopName}</a>`,
    );
  });

  it("renders a light/dark pair as two eager low-priority pictures named by the shop name, without title or preload", () => {
    const html = renderToStaticMarkup(
      <BrandLogo locale="en" t={t} logo={{ kind: "image", light, dark }} />,
    );
    expect(html).toMatch(/^<a class="fk-logo" href="\/en">/);
    expect(html).not.toContain("title=");
    const [first, second] = images(html);
    expect(images(html)).toHaveLength(2);
    for (const [img, src] of [
      [first, "/brand/logo.svg"],
      [second, "/brand/logo-dark.svg"],
    ] as const) {
      expect(img).toContain(`alt="${shopName}"`);
      expect(img).toContain(`src="${src}"`);
      expect(img).toContain('width="120"');
      expect(img).toContain('height="32"');
      expect(img).toContain('loading="eager"');
      expect(img).toMatch(/fetchpriority="low"/i);
    }
    expect(html).not.toContain("/_next/image");
    expect(first).toContain('class="fk-logo-image fk-logo-light"');
    expect(second).toContain('class="fk-logo-image fk-logo-dark"');
    expect(html).not.toContain("<link");
  });

  it("renders one picture for a logo declared dark-safe", () => {
    const html = renderToStaticMarkup(
      <BrandLogo locale="uk" t={t} logo={{ kind: "image", light, darkSafe: true }} />,
    );
    expect(images(html)).toHaveLength(1);
    expect(html).toContain('class="fk-logo-image"');
    expect(html).not.toContain("fk-logo-dark");
  });

  it("refuses at render what the config check refuses: a remote host, a dot segment, a doubled slash", () => {
    for (const src of [
      "//evil.example/logo.svg",
      "/brand/../../secret.svg",
      "/brand//logo.svg",
    ] as const) {
      expect(
        () =>
          renderToStaticMarkup(
            <BrandLogo
              locale="uk"
              t={t}
              logo={{ kind: "image", light: { src, width: 1, height: 1 }, darkSafe: true }}
            />,
          ),
        src,
      ).toThrow(/under public/);
    }
  });
});
