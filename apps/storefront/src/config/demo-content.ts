import type { ShopPageSlug } from "./shop-pages";
import demoContentFile from "./demo-content.json";

/**
 * Which parts of the storefront still show the TEMPLATE's demo copy (repair batch 2, plan
 * docs/plans/2026-11-06-storefront-shop-pages.md). Nothing reads it at runtime and no page shows a marker: the copy reads like a
 * real shop's, so a shopper of the demo sees no placeholder text. It exists for the release check: with
 * `STOREFRONT_REQUIRE_LEGAL_TEXT=true`, `next build` REFUSES while any entry is still listed or `true` (`next.config.ts`
 * `assertNoLegalPlaceholders`, which runs in plain Node and reads the JSON file itself; `demo-content.spec.ts` keeps both sides
 * in step). A client fork removes an entry, or sets it to `false`, in the same change that replaces that content:
 *
 * - `shopPages`: the slugs of `config/shop-pages.ts` whose `shopPages.<page>.*` texts are still the template's;
 * - `contacts`: `config/contacts.ts` and the `contacts.demo.*` messages;
 * - `home`: the home page's hero and "About the shop" texts (`home.hero.*`, `home.about.*`);
 * - `trustBar`: the trust bar lines (`config/trust-bar.ts`, `trust.*`), which read like service promises.
 */
export interface DemoContent {
  shopPages: readonly ShopPageSlug[];
  contacts: boolean;
  home: boolean;
  trustBar: boolean;
}

export const demoContent: DemoContent = demoContentFile as DemoContent;
