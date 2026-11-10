import { describe, expect, inject, it } from "vitest";
import { brand } from "../config/brand";
import { customSections } from "../config/custom-sections";
import { footerConfig } from "../config/footer";
import { headerConfig } from "../config/header";
import { homeSections } from "../config/home";
import * as brandFixture from "./brand-fork-fixture";
import * as homeConfigFixture from "./home-config-fork-fixture";
import * as homeRegistryFixture from "./home-fork-fixture";
import * as layoutFixture from "./layout-fork-fixture";

declare module "vitest" {
  export interface ProvidedContext {
    /**
     * Which fork-owned configs this run replaces with fixtures: `none` (`vitest.config.ts`), `brand-layout`
     * (`vitest.brand-fork.config.ts`: brand, header, footer) or `home` (`vitest.home-fork.config.ts`: home, custom sections).
     */
    forkRun: "none" | "brand-layout" | "home";
  }
}

/**
 * Canary of the fork runs: their aliases must really replace the fork-owned configs with the fixtures (a changed import path
 * or a broken alias regex would otherwise run the suite again on the template's defaults and prove nothing), each run only its
 * own, and the default run must read the real files.
 */
describe("the fork-owned configs a run reads", () => {
  const forkRun = inject("forkRun");

  it("knows which run it is", () => {
    expect(["none", "brand-layout", "home"]).toContain(forkRun);
  });

  it("reads the brand, header and footer fixtures exactly in the brand-layout run", () => {
    const expected = forkRun === "brand-layout";
    expect(brand === brandFixture.brand).toBe(expected);
    expect(headerConfig === layoutFixture.headerConfig).toBe(expected);
    expect(footerConfig === layoutFixture.footerConfig).toBe(expected);
  });

  it("reads the home and custom section fixtures exactly in the home run", () => {
    const expected = forkRun === "home";
    expect(homeSections === homeConfigFixture.homeSections).toBe(expected);
    expect(customSections === homeRegistryFixture.customSections).toBe(expected);
  });
});
