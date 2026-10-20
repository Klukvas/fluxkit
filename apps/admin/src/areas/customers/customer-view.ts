import type { StatusTone } from "@fluxkit/ui";
import { PATHS, buildPath } from "../../router/paths";
import { writeQuery } from "../../router/query";

/**
 * How the customers area presents what the API answered. Pure. Names, emails and phones are plain strings that the views
 * render as text only; nothing here builds HTML, and the only data that reaches a URL is the customer's id.
 */

/** The badge of the account's activity: the text says it, the tone is a hint only. */
export const CUSTOMER_STATUS_TONES: Record<"active" | "deactivated", StatusTone> = {
  active: "success",
  deactivated: "danger",
};

export function statusLabelKey(isActive: boolean): string {
  return isActive ? "customer.status.active" : "customer.status.deactivated";
}

export function statusTone(isActive: boolean): StatusTone {
  return CUSTOMER_STATUS_TONES[isActive ? "active" : "deactivated"];
}

export function lockLabelKey(isLocked: boolean): string {
  return isLocked ? "customer.lock.locked" : "customer.lock.notLocked";
}

export function lockTone(isLocked: boolean): StatusTone {
  return isLocked ? "warning" : "neutral";
}

/** The first and last name joined, a missing part skipped; `""` when the customer gave neither. */
export function fullName(firstName: string, lastName: string): string {
  return [firstName, lastName]
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join(" ");
}

/** A customer's detail page. The id is the only thing in the URL. */
export function customerHref(id: string): string {
  return buildPath(PATHS.customerDetail, { id });
}

/** The order list filtered by this customer account (the `customerId` filter of `GET /admin/orders`). */
export function customerOrdersHref(id: string): string {
  return `${PATHS.orders}${writeQuery({ customerId: id })}`;
}
