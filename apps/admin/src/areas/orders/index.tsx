import type { LazyFile } from "../../messages";
import { OrderDetailPage } from "./order-detail-page";
import { OrderListPage } from "./order-list-page";

/** The orders area (plan step 8) loads its own messages only (`orders`). */
export const MESSAGE_FILES: readonly LazyFile[] = ["orders"];

/** `/orders`: the order list. */
export const OrdersPage = OrderListPage;
/** `/orders/:id`: the order detail with its actions. */
export { OrderDetailPage };
