import type { ShopFont } from "../config/fonts";

/**
 * The `className` of `<html>`: the `variable` classes of the shop's fonts (`config/fonts.ts`), or `undefined` when there are
 * none, so the template's first HTML carries no empty attribute.
 */
export function fontVariableClasses(fonts: readonly ShopFont[]): string | undefined {
  return fonts.length === 0 ? undefined : fonts.map((font) => font.variable).join(" ");
}
