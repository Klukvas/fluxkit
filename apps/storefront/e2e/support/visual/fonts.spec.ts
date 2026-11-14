import { describe, expect, it } from "vitest";
import { blockOptionalFontDisplay } from "./fonts.ts";

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
