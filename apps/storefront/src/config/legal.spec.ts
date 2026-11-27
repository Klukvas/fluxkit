import { messagePlaceholders } from "@fluxkit/ui";
import { describe, expect, it } from "vitest";
import { LEGAL_TEXT_SLUGS } from "../../next.config";
import { messagesByLocale } from "../messages";
import { demoContent } from "./demo-content";
import { legalPages, legalSections } from "./legal";

const identityPlaceholders = [
  "sellerName",
  "sellerTaxId",
  "sellerAddress",
  "sellerEmail",
  "sellerPhone",
  "privacyEmail",
  "website",
];

describe("legal text sections", () => {
  it("has unique anchor ids on each page, with every title and body in both locales and no unused section keys", () => {
    for (const page of legalPages) {
      const sections = legalSections[page.slug];
      expect(new Set(sections.map((section) => section.id)).size).toBe(sections.length);
      const keys = sections.flatMap((section) => {
        expect(section.titleKey).toBe(`legal.${page.slug}.section.${section.id}.title`);
        expect(section.bodyKey).toBe(`legal.${page.slug}.section.${section.id}.body`);
        return [section.titleKey, section.bodyKey];
      });
      for (const [locale, messages] of Object.entries(messagesByLocale)) {
        for (const key of keys) {
          expect(key, `${locale} ${page.slug}`).toBeDefined();
          expect(messages[key as keyof typeof messages], `${locale} ${key}`).toBeTruthy();
        }
        expect(
          Object.keys(messages)
            .filter((key) => key.startsWith(`legal.${page.slug}.section.`))
            .sort(),
        ).toEqual([...keys].sort());
      }
    }
  });

  it("has no section message for an unconfigured page or section", () => {
    const keys = Object.values(legalSections)
      .flatMap((sections) => sections.flatMap((section) => [section.titleKey, section.bodyKey]))
      .sort();
    for (const messages of Object.values(messagesByLocale)) {
      expect(
        Object.keys(messages)
          .filter((key) => /^legal\.[^.]+\.section\./.test(key))
          .sort(),
      ).toEqual(keys);
    }
  });

  it("uses only supplied identity values in intros and bodies and supplied slots in other legal messages", () => {
    for (const [locale, messages] of Object.entries(messagesByLocale)) {
      for (const [key, message] of Object.entries(messages)) {
        if (!key.startsWith("legal.")) continue;
        const allowed =
          key === "legal.updated"
            ? ["date"]
            : key === "legal.privacy.selfService"
              ? ["account"]
              : identityPlaceholders;
        for (const placeholder of messagePlaceholders(message)) {
          expect(allowed, `${locale} ${key}: {${placeholder}}`).toContain(placeholder);
        }
      }
    }
  });

  it("lists only known legal slugs as default copy and keeps the plain Node guard in sync", () => {
    const slugs = legalPages.map((page) => page.slug);
    expect(LEGAL_TEXT_SLUGS).toEqual(slugs);
    expect(demoContent.legalTexts).toEqual(slugs);
    for (const slug of demoContent.legalTexts) expect(slugs).toContain(slug);
  });
});
