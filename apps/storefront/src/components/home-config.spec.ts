import { describe, expect, it } from "vitest";
import { customSections } from "../config/custom-sections";
import {
  checkHomeSections,
  homeSections,
  HOME_SECTION_REVEALS,
  type HomeSection,
} from "../config/home";
import { resolveCustomSection } from "../lib/custom-sections";

// FORK-PROOF (plan 2026-11-08-design-changeability.md, L4): checks the REAL `config/home.ts` against the REAL
// `config/custom-sections.ts`, whatever a fork put in them. A typo in a custom section's name fails here (and in `next dev`)
// instead of being logged and left out in production.

describe("the home config and the custom section registry together", () => {
  it("validate: unique ids, known widths, usable custom names", () => {
    expect(() => {
      checkHomeSections(homeSections);
    }).not.toThrow();
  });

  it("resolve every custom section of config/home.ts to a registered server component", () => {
    for (const section of homeSections) {
      if (section.kind !== "custom") continue;
      expect(
        Object.keys(customSections),
        `custom section "${section.id}" names "${section.name}"`,
      ).toContain(section.name);
      expect(resolveCustomSection(section, customSections), section.id).toBeTypeOf("function");
    }
  });
});

describe("home reveal validation", () => {
  it("accepts both documented effects and omission", () => {
    expect(HOME_SECTION_REVEALS).toEqual(["fade-up", "pop-in"]);
    for (const reveal of [...HOME_SECTION_REVEALS, undefined]) {
      expect(() =>
        checkHomeSections([{ kind: "trust", id: "trust", titleKey: "home.trust.title", reveal }]),
      ).not.toThrow();
      expect(() =>
        checkHomeSections([{ kind: "custom", id: "custom", name: "strip", width: "full", reveal }]),
      ).not.toThrow();
    }
  });
  it("refuses unknown values even when a cast bypasses the type", () => {
    for (const reveal of ["slide", "", null, false]) {
      const sections = [
        { kind: "trust", id: "trust", titleKey: "home.trust.title", reveal },
      ] as unknown as HomeSection[];
      expect(() => checkHomeSections(sections)).toThrow(/reveal.*allowed: fade-up, pop-in/);
    }
  });
});
