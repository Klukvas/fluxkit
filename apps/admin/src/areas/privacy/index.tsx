import type { LazyFile } from "../../messages";
import { PrivacyLookupPage } from "./lookup-page";
import { PrivacyRequestDetailPage } from "./request-detail-page";
import { PrivacyRequestsPage } from "./requests-page";

/**
 * The Privacy area (privacy plan step 9, permission privacy.manage, owner only) loads its own messages and the orders'
 * (the lookup words the status of a guest order with the orders file's `order.status.*`).
 */
export const MESSAGE_FILES: readonly LazyFile[] = ["privacy", "orders"];

/** `/privacy`: the privacy requests. */
export { PrivacyRequestsPage };
/** `/privacy/lookup`: what the shop holds for an email address. */
export { PrivacyLookupPage };
/** `/privacy/requests/:id`: one request with export, erasure and reject. */
export { PrivacyRequestDetailPage };
