import type { LazyFile } from "../../messages";
import { BannerDetailPage, BannerNewPage } from "./banner-editor-pages";
import { BannersPage } from "./banners-page";

/**
 * The Storefront area, "Home banners" (plan 2026-11-05-admin-home-banners.md, D5 and section 7; ADR 0046; `catalog.read`
 * to read, `catalog.write` to change). It reuses the form parts, upload queue and notices of the catalog dictionaries, so
 * it loads their messages too, plus its own (`banners`).
 */
export const MESSAGE_FILES: readonly LazyFile[] = ["catalog-dictionaries", "banners"];

/** `/storefront/banners`: the banners in their order. */
export { BannersPage };
/** `/storefront/banners/new`: create a banner. */
export { BannerNewPage };
/** `/storefront/banners/:id`: edit or delete a banner. */
export { BannerDetailPage };
