import { describe, expect, it } from "vitest";
import { homeSections } from "../config/home";
import { isTemplateHomeComposition, templateHomeSections } from "./home-template-default";

// UPSTREAM-ONLY, FORK-DELETABLE (`docs/customization.md` section 3). The specs that pin the template's default home page skip
// themselves once `config/home.ts` differs from `lib/home-template-default.ts`; this spec makes sure that never happens by
// accident upstream (a changed default with a stale copy would silently skip them). Left out of `vitest.home-fork.config.ts`.

describe("the template's default home composition (upstream only)", () => {
  it("equals its frozen copy in lib/home-template-default.ts, so the default-page pins run", () => {
    expect(
      isTemplateHomeComposition(homeSections),
      "Upstream: config/home.ts changed, update lib/home-template-default.ts (and the frozen markup) with it. " +
        "A fork that changed its home page deletes this spec.",
    ).toBe(true);
    expect(homeSections).toEqual(templateHomeSections);
  });
});
