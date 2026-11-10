// TEMPLATE-DEFAULT CHECK, upstream-only and FORK-DELETABLE (plan 2026-11-08-design-changeability.md, L2 and principle 6): the
// template ships `cards/custom.ts` empty, and the specs that pin the built-in cards mock it with the copy in
// `test-support/template-defaults.ts`, which must equal it. A fork that registers a card deletes this file
// (`docs/customization.md`, step 0); the fork runs leave it out (their fixture overrides the cards).
import { describe, expect, it } from "vitest";
import * as templateDefaults from "../../test-support/template-defaults";
import { customCards } from "./custom";

describe("components/cards/custom.ts in the template", () => {
  it("is empty and equals the copy the card-pinning specs mock in", () => {
    expect(customCards).toEqual({});
    expect(templateDefaults.customCards).toEqual(customCards);
  });
});
