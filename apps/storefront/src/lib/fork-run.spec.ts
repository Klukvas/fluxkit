import { describe, expect, inject, it } from "vitest";
import { customCards } from "../components/cards/custom";
import { cardRegistry } from "../components/cards/registry";
import { brand } from "../config/brand";
import { customSections } from "../config/custom-sections";
import { footerConfig } from "../config/footer";
import { headerConfig } from "../config/header";
import { homeSections } from "../config/home";
import { slots } from "../config/slots";
import * as brandFixture from "./brand-fork-fixture";
import * as cardsFixture from "./cards-fork-fixture";
import * as footerFixture from "./footer-fork-fixture";
import * as headerFixture from "./header-fork-fixture";
import * as homeConfigFixture from "./home-config-fork-fixture";
import * as homeRegistryFixture from "./home-fork-fixture";
import * as slotsFixture from "./slots-fork-fixture";

declare module "vitest" {
  export interface ProvidedContext {
    /**
     * Which fork-owned configs this run replaces with fixtures: `none` (`vitest.config.ts`), `brand-layout`
     * (`vitest.brand-fork.config.ts`: brand, header, footer, UI slots and the `grid` and `list` cards with the default home) or `home` (`vitest.home-fork.config.ts`: home, custom sections, UI slots, the cards).
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
    expect(headerConfig === headerFixture.headerConfig).toBe(expected);
    expect(footerConfig === footerFixture.footerConfig).toBe(expected);
  });

  it("reads the fork's own cards fixture exactly in the two fork runs", () => {
    const expected = forkRun !== "none";
    expect(customCards === cardsFixture.customCards).toBe(expected);
    // The registry's own import (`./custom`) is swapped too: the lists render the fork's `grid` and `list` cards.
    expect(cardRegistry["grid"] === cardsFixture.customCards["grid"]).toBe(expected);
    expect(cardRegistry["list"] === cardsFixture.customCards["list"]).toBe(expected);
  });

  it("reads the home and custom section fixtures exactly in the home run", () => {
    const expected = forkRun === "home";
    expect(homeSections === homeConfigFixture.homeSections).toBe(expected);
    expect(customSections === homeRegistryFixture.customSections).toBe(expected);
  });

  it("reads the filled UI slots fixture exactly in the two fork runs", () => {
    expect(slots === slotsFixture.slots).toBe(forkRun !== "none");
  });
});
