import type { AdminOperationName } from "@fluxkit/api-client";
import type { ComponentType } from "react";
import type { EditorTabId } from "../areas/products/publish-problems";
import type { ProductTabProps } from "../areas/products/tab-props";
import { AttributesTab } from "../areas/products/tabs/attributes-tab";
import { CategoriesTab } from "../areas/products/tabs/categories-tab";
import { GeneralTab } from "../areas/products/tabs/general-tab";
import { MediaTab } from "../areas/products/tabs/media-tab";
import { OptionsTab } from "../areas/products/tabs/options-tab";
import { PricesTab } from "../areas/products/prices/prices-tab";
import { StockTab } from "../areas/products/stock/stock-tab";
import { VariantsTab } from "../areas/products/tabs/variants-tab";

/**
 * The product editor's tabs as configuration (plan, "Layout is configuration"): in order, each with its message key, the
 * API operation whose permission shows it (the tab's main read), and its panel. A redesign reorders or regroups here, not
 * in the editor. Internal in v1 (a feature module that needs a tab gets a registry contract in its own plan). Imported
 * only by the products area, so it travels in that lazy chunk.
 */
export interface ProductEditorTab {
  id: EditorTabId;
  messageKey: string;
  operation: AdminOperationName;
  Panel: ComponentType<ProductTabProps>;
}

export const PRODUCT_EDITOR_TABS: readonly ProductEditorTab[] = [
  { id: "general", messageKey: "products.tab.general", operation: "getProduct", Panel: GeneralTab },
  {
    id: "attributes",
    messageKey: "products.tab.attributes",
    operation: "getProductType",
    Panel: AttributesTab,
  },
  {
    id: "categories",
    messageKey: "products.tab.categories",
    operation: "getProduct",
    Panel: CategoriesTab,
  },
  { id: "media", messageKey: "products.tab.media", operation: "getProduct", Panel: MediaTab },
  { id: "options", messageKey: "products.tab.options", operation: "getProduct", Panel: OptionsTab },
  {
    id: "variants",
    messageKey: "products.tab.variants",
    operation: "listVariants",
    Panel: VariantsTab,
  },
  {
    id: "prices",
    messageKey: "products.tab.prices",
    operation: "listProductPrices",
    Panel: PricesTab,
  },
  {
    id: "stock",
    messageKey: "products.tab.stock",
    operation: "getProductInventory",
    Panel: StockTab,
  },
];
