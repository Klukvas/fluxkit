import type { AdminShipment, AdminShipmentCreateResult, ProblemDetails } from "@fluxkit/api-client";
import {
  describeFieldError,
  describeProblem,
  type MessageDescriptor,
} from "../../lib/problem-messages";
import { CARRIER_REASONS, safeCarrierCodes } from "./shipment-carrier";

/**
 * How the order detail words what the shipment routes answered (`docs/api/shipping.md`, "Shipments (admin)"). Pure. The
 * API's English `detail` is never shown; every text is a message of the orders file.
 */

/**
 * The refusals (`409 rule_violation`) of the shipment routes that get an explanation of their own: what happened and what to
 * do instead. `invalid_transition` here is the shipment's, not the order's.
 */
export const SHIPMENT_REFUSAL_RULES = [
  "order_not_paid",
  "awaiting_stock",
  "no_carrier",
  "provider_not_enabled",
  "carrier_not_supported",
  "shipment_exists",
  "shipment_not_unknown",
  "reconcile_too_early",
  "shipment_not_tracked",
  "invalid_transition",
  "label_not_available",
  "carrier_rejected",
  "carrier_invalid_credentials",
  // The contact data was erased (privacy plan, ADR 0033): unreachable through the privacy service, which refuses an order with
  // an active shipment, but a route a script calls must still be explained.
  "contact_erased",
] as const;

/** Whole seconds of a `Retry-After` header, or `null` when it is missing or not a plausible wait. */
export function retrySeconds(header: string | null): number | null {
  if (header === null || !/^\d{1,4}$/.test(header)) return null;
  const seconds = Number(header);
  return seconds >= 1 && seconds <= 3600 ? seconds : null;
}

/**
 * A refusal of a shipment route in words. A `503 shipping_provider_unavailable` says nothing was changed and when to try
 * again; a carrier refusal carries the carrier's raw codes in small print (never its text).
 */
export function describeShipmentProblem(
  status: number,
  problem: ProblemDetails,
  retryAfter: string | null,
): MessageDescriptor {
  if (problem.code === "shipping_provider_unavailable") {
    const seconds = retrySeconds(retryAfter);
    return seconds === null
      ? { key: "shipment.unavailable" }
      : { key: "shipment.unavailableRetry", values: { seconds } };
  }
  const rule = problem.code === "rule_violation" ? problem.rule : undefined;
  if (rule !== undefined && (SHIPMENT_REFUSAL_RULES as readonly string[]).includes(rule)) {
    const codes = safeCarrierCodes(problem.providerCodes);
    return codes.length === 0
      ? { key: `shipment.refusal.${rule}` }
      : { key: `shipment.refusal.${rule}`, code: codes.join(", ") };
  }
  return describeProblem(status, problem);
}

/** The fields of the create form a `400` can name (`errors[].path`), and the form field each belongs to. */
export function createFieldOfPath(path: string): string {
  return path.startsWith("declaredValue") ? "declaredValue" : path;
}

/** A `400` of the create route on the form's fields; what has no field goes to the summary. */
export function createFieldErrors(
  problem: ProblemDetails,
  fields: readonly string[],
): { fields: Partial<Record<string, MessageDescriptor>>; other: MessageDescriptor[] } {
  const found: Partial<Record<string, MessageDescriptor>> = {};
  const other: MessageDescriptor[] = [];
  for (const error of problem.errors ?? []) {
    const descriptor = describeFieldError(error.code);
    const field = createFieldOfPath(error.path);
    if (!fields.includes(field)) other.push(descriptor);
    else if (found[field] === undefined) found[field] = descriptor;
  }
  return { fields: found, other };
}

/** What the status line says after an action on shipments. */
export type ShipmentNotice =
  | { kind: "created"; trackingNumber: string | null }
  | { kind: "failed"; reason: string; providerCodes: string[] }
  | { kind: "unknownCreate" }
  | { kind: "lostCreate" }
  | { kind: "reconciled"; found: boolean }
  | { kind: "refreshed" }
  | { kind: "cancelled" }
  | { kind: "labelReady" }
  | { kind: "lost"; action: "reconcile" | "refresh" | "cancel" | "label" };

/**
 * The notice for the answer of a create. `201` is the answer for every outcome at the carrier: `created`, `failed` (a
 * typed reason) or `unknown` (a waybill may exist: reconcile, never create again). Anything else the API could put there
 * (it cannot) is treated as unknown too, so the screen never invites a second create.
 */
export function createNotice(result: AdminShipmentCreateResult): ShipmentNotice {
  const { shipment, failure } = result;
  if (shipment.status === "created") {
    return { kind: "created", trackingNumber: shipment.trackingNumber };
  }
  if (shipment.status === "failed") {
    const reason = failure?.reason;
    return {
      kind: "failed",
      reason:
        reason !== undefined && (CARRIER_REASONS as readonly string[]).includes(reason)
          ? reason
          : "rejected",
      providerCodes: safeCarrierCodes(failure?.providerCodes),
    };
  }
  return { kind: "unknownCreate" };
}

/** The notice for a settled reconcile: the waybill was found (`created`) or there is none (`failed`). */
export function reconcileNotice(shipment: Pick<AdminShipment, "status">): ShipmentNotice {
  return { kind: "reconciled", found: shipment.status !== "failed" };
}
