/**
 * The header of a category page (plan 2026-11-03-storefront-design-b.md, decision 4). Internal to the storefront, like
 * `home.ts`: a client fork edits it. The texts are the category's own name and description from the catalog; this file
 * holds no copy.
 */
import type { LocalImage } from "./home";

export interface CategoryPageConfig {
  /**
   * `banner`: the name and the description on a token surface with an optional picture (the home page's hero component);
   * `plain`: the heading and the description as on the catalog page.
   */
  header: "plain" | "banner";
  /** Picture of a category's banner by its slug (files under `public/`); a banner without one is text only. */
  images: Readonly<Record<string, LocalImage>>;
}

export const categoryPageConfig: CategoryPageConfig = {
  header: "banner",
  images: {},
};
