import type { AdminPayment, AdminPaymentPage } from "@fluxkit/api-client";

/**
 * The attention list (`GET /admin/payments?needsAttention=true`, newest first, a keyset cursor): the pages the admin has
 * loaded so far, appended in order. A payment that moves between pages while the admin reads (the list is live, an item
 * closed elsewhere) is listed once. Pure.
 */

/** Rows per page asked for (the API allows 1 to 100; its default is 20). */
export const ATTENTION_PAGE_SIZE = 20;

export interface AttentionRow {
  orderId: string;
  orderNumber: string;
  payment: AdminPayment;
}

export interface AttentionList {
  rows: AttentionRow[];
  /** The `nextCursor` of the last page, unchanged; `null` when there is no further page. */
  nextCursor: string | null;
}

export function listFromPage(page: AdminPaymentPage): AttentionList {
  return appendPage({ rows: [], nextCursor: null }, page);
}

export function appendPage(list: AttentionList, page: AdminPaymentPage): AttentionList {
  const seen = new Set(list.rows.map((row) => row.payment.id));
  const added = page.items.filter((item) => !seen.has(item.payment.id));
  return { rows: [...list.rows, ...added], nextCursor: page.nextCursor };
}
