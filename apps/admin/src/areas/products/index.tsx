import type { LazyFile } from "../../messages";

/**
 * Products area (plan step 6): the list, the create form and the editor, one lazy chunk. The screens reuse the form parts,
 * pickers and the category tree of the catalog dictionaries, so they load that area's messages too.
 */
export const MESSAGE_FILES: readonly LazyFile[] = ["catalog-dictionaries", "products"];

export { ProductNewPage } from "./product-create-page";
export { ProductDetailPage } from "./product-editor-page";
export { ProductsPage } from "./product-list-page";
