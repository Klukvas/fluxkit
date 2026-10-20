import type { LazyFile } from "../../messages";
import { CustomerDetailPage } from "./customer-detail-page";
import { CustomerListPage } from "./customer-list-page";

/** The customers area (plan step 9) loads its own messages only (`customers`). */
export const MESSAGE_FILES: readonly LazyFile[] = ["customers"];

/** `/customers`: the customer list. */
export const CustomersPage = CustomerListPage;
/** `/customers/:id`: the customer detail with its actions. */
export { CustomerDetailPage };
