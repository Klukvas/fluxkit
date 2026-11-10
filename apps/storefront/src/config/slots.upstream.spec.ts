// TEMPLATE-DEFAULT CHECK, upstream-only and FORK-DELETABLE (plan 2026-11-08-design-changeability.md, S1 and principle 6): the
// template ships `config/slots.tsx` empty, so every slot renders nothing (no element, no byte; `slot-places.spec.tsx` proves the
// zero bytes, the frozen header, footer and card markup the rest). A fork that fills its slots deletes this file
// (`docs/customization.md`); the fork run (`vitest.home-fork.config.ts`) leaves out every `*.upstream.spec.*`.
import { describe, expect, it } from "vitest";
import * as templateDefaults from "../test-support/template-defaults";
import { slots } from "./slots";

describe("config/slots.tsx in the template", () => {
  it("is empty", () => {
    expect(slots).toEqual({});
  });

  it("equals the copy the specs pinning the template's markup mock in (test-support/template-defaults.ts)", () => {
    expect(templateDefaults.slots).toEqual(slots);
  });
});
