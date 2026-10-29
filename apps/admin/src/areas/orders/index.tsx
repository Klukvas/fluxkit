import type { LazyFile } from "../../messages";
import { OrderDetailPage } from "./order-detail-page";
import { OrderListPage } from "./order-list-page";

/** The orders area (plan step 8) loads its own messages (`orders`) and the payment panel's (`payments`, payments plan step 10). */
export const MESSAGE_FILES: readonly LazyFile[] = ["orders", "payments"];

/** `/orders`: the order list. */
export const OrdersPage = OrderListPage;
/** `/orders/:id`: the order detail with its actions. */
export { OrderDetailPage };
