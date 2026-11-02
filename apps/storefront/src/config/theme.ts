/**
 * Light and dark theme of the storefront (plan 2026-11-03-storefront-design-b.md). Internal to the storefront, like
 * `checkout.ts` and `trust-bar.ts`: a client fork edits these two values. The colours of both themes live in
 * `packages/theme/src/tokens.css`.
 */
import type { ThemeMode } from "@fluxkit/theme";

export interface ThemeConfig {
  /**
   * The theme of a shopper who has not chosen one: `system` follows the device (light unless it asks for dark), `light` or
   * `dark` fixes it.
   */
  defaultMode: ThemeMode;
  /**
   * Show the Light / Dark / System switch in the footer. With `false` the shop always uses `defaultMode` and ignores an
   * earlier choice stored in the `fluxkit_theme` cookie.
   */
  showToggle: boolean;
}

export const themeConfig: ThemeConfig = {
  defaultMode: "system",
  showToggle: true,
};
