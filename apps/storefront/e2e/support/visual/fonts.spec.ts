import { describe, expect, it } from "vitest";
import { blockOptionalFontDisplay, unsettledWebFonts, type VisualFontFace } from "./fonts.ts";

describe("unsettledWebFonts", () => {
  const face: VisualFontFace = {
    family: "rubik",
    weight: "300 900",
    style: "normal",
    status: "error",
  };
  const webRule = { family: "rubik", src: 'url("rubik.woff2") format("woff2")' };

  it.each(["error", "loading"] as const)("rejects URL faces with status %s", (status) => {
    const unsettled = { ...face, status };
    expect(unsettledWebFonts([unsettled], [webRule])).toEqual([unsettled]);
  });

  it.each(["loaded", "unloaded"] as const)("accepts URL faces with status %s", (status) => {
    expect(unsettledWebFonts([{ ...face, status }], [webRule])).toEqual([]);
  });

  it.each(["error", "loading"] as const)(
    "accepts missing local-only aliases with status %s",
    (status) => {
      const local = { ...face, family: "rubik Fallback", status };
      expect(
        unsettledWebFonts([local], [webRule, { family: local.family, src: 'local("Arial")' }]),
      ).toEqual([]);
    },
  );

  it("matches quoted and case-varied families without collapsing internal whitespace", () => {
    const quoted = { ...face, family: "  'RuBiK Family'  " };
    expect(unsettledWebFonts([quoted], [{ ...webRule, family: ' "rubik family" ' }])).toEqual([
      quoted,
    ]);
    expect(unsettledWebFonts([quoted], [{ ...webRule, family: "rubik  family" }])).toEqual([]);
  });

  it("checks mixed local and URL sources, including uppercase URL tokens", () => {
    expect(
      unsettledWebFonts([face], [{ ...webRule, src: 'local("Arial"), URL("rubik.woff2")' }]),
    ).toEqual([face]);
  });

  it("conservatively checks all unsettled faces of a family shared by URL and local rules", () => {
    const localFace = { ...face, weight: "400", style: "italic" };
    expect(
      unsettledWebFonts([face, localFace], [webRule, { family: "rubik", src: 'local("Arial")' }]),
    ).toEqual([face, localFace]);
  });

  it("ignores unrelated families without special-casing the word Fallback", () => {
    const fallback = { ...face, family: "rubik Fallback" };
    expect(unsettledWebFonts([face, fallback], [{ ...webRule, family: fallback.family }])).toEqual([
      fallback,
    ]);
  });

  it.each([
    'local("Name url(fake)")',
    "local('Name URL(fake)')",
    String.raw`local("Name \"url(fake)")`,
    'local("Arial") /* url(fake) */',
    "noturl(fake)",
    "custom-url(fake)",
  ])("ignores URL lookalikes in %s", (src) => {
    expect(unsettledWebFonts([face], [{ ...webRule, src }])).toEqual([]);
  });
});

describe("blockOptionalFontDisplay", () => {
  it("rewrites minified Next font faces without changing utilities or custom properties", () => {
    const before =
      '@font-face{font-family:rubik;src:url(../media/rubik_wght-s.37uc9mvjr59l6.woff2)format("woff2");font-display:optional;font-weight:300 900;font-style:normal}';
    const after =
      '@font-face{font-family:rubik;src:url(../media/rubik_wght-s.37uc9mvjr59l6.woff2)format("woff2");font-display:block;font-weight:300 900;font-style:normal}';
    const utilities =
      ".font-display{font-family:rubik,Arial,sans-serif}:root{--fk-font-display:optional}.other{font-display:optional}";
    expect(blockOptionalFontDisplay(before + utilities)).toBe(after + utilities);
  });

  it("handles several faces, uppercase and whitespace, leaving swap and block byte-identical", () => {
    const before = [
      '@FONT-FACE { font-display : OPTIONAL ; font-family: "First"; }',
      "@media screen{@font-face{font-family:Second;FONT-DISPLAY:\noptional}}",
      "@font-face{font-family:Third;font-display:swap}",
      "@font-face{font-display:block;font-family:Fourth}",
      "@font-face{--fk-font-display:optional;font-family:Fifth;font-display:optional}",
    ].join("\n");
    const after = [
      '@FONT-FACE { font-display : block ; font-family: "First"; }',
      "@media screen{@font-face{font-family:Second;FONT-DISPLAY:\nblock}}",
      "@font-face{font-family:Third;font-display:swap}",
      "@font-face{font-display:block;font-family:Fourth}",
      "@font-face{--fk-font-display:optional;font-family:Fifth;font-display:block}",
    ].join("\n");
    expect(blockOptionalFontDisplay(before)).toBe(after);
  });

  it("leaves CSS without font faces unchanged", () => {
    const css = ".font-display{font-family:rubik}:root{--fk-font-display:optional}";
    expect(blockOptionalFontDisplay(css)).toBe(css);
  });

  it("preserves comments and strings that contain font-face or descriptor lookalikes", () => {
    const prefix =
      '/* @font-face{font-display:optional} */.label{content:"@font-face{font-display:optional}"}';
    const face =
      '@font-face{font-family:"Name; font-display:optional}";src:url("font;{}.woff2");/* font-display:optional */font-display:optional}';
    // The comment separates declarations without altering their meaning.
    const expected = face.replace(/font-display:optional}$/, "font-display:block}");
    expect(blockOptionalFontDisplay(prefix + face)).toBe(prefix + expected);
  });
});
