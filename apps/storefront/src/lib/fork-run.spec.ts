import { describe, expect, inject, it } from "vitest";
import { brand } from "../config/brand";
import { footerConfig } from "../config/footer";
import { headerConfig } from "../config/header";
import * as brandFixture from "./brand-fork-fixture";
import * as layoutFixture from "./layout-fork-fixture";

declare module "vitest" {
  export interface ProvidedContext {
    /** `true` in the fork run (`vitest.brand-fork.config.ts`), `false` in the default one (`vitest.config.ts`). */
    forkRun: boolean;
  }
}

/**
 * Canary of the fork run: its aliases must really replace the fork-owned configs with the fixtures (a changed import path or
 * a broken alias regex would otherwise run the suite twice on the template's defaults and prove nothing), and the default run
 * must read the real files.
 */
describe("the fork-owned configs a run reads", () => {
  it("are the fixtures in the fork run and the real files otherwise", () => {
    const forkRun = inject("forkRun");
    expect(typeof forkRun).toBe("boolean");
    expect(brand === brandFixture.brand).toBe(forkRun);
    expect(headerConfig === layoutFixture.headerConfig).toBe(forkRun);
    expect(footerConfig === layoutFixture.footerConfig).toBe(forkRun);
  });
});
