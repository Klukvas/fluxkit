import type { LazyFile } from "../../messages";
import { PaymentAttentionPage } from "./attention-page";

/**
 * The payments area (payments plan step 10) loads its own messages (`payments`) and the orders file: its list reuses the
 * orders area's money text, links and problem helpers. The payment panel of the order detail lives here too and is
 * imported by the orders area, which therefore loads `payments` as well.
 */
export const MESSAGE_FILES: readonly LazyFile[] = ["orders", "payments"];

/** `/payments`: the payments that need attention. */
export const PaymentsPage = PaymentAttentionPage;
