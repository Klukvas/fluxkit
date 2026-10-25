import type { LazyFile } from "../../messages";
import { ShippingMethodDetailPage, ShippingMethodNewPage } from "./method-pages";
import { ShippingPage } from "./methods-page";
import { ShippingProviderDetailPage, ShippingProvidersPage } from "./provider-pages";

/**
 * The Shipping settings area (shipping plan step 11, permission shipping.manage). It reuses the form parts of the catalog
 * dictionaries (locale fields, error summary, notices), so it loads their messages too, plus its own (`shipping`).
 */
export const MESSAGE_FILES: readonly LazyFile[] = ["catalog-dictionaries", "shipping"];

/** `/shipping`: the delivery methods. */
export { ShippingPage };
/** `/shipping/methods/new`: create a method. */
export { ShippingMethodNewPage };
/** `/shipping/methods/:id`: edit or delete a method. */
export { ShippingMethodDetailPage };
/** `/shipping/providers`: the carriers. */
export { ShippingProvidersPage };
/** `/shipping/providers/:code`: one carrier's profile and connection check. */
export { ShippingProviderDetailPage };
