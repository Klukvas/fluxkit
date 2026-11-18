import type { PaymentHandoff, StoreClient } from "@fluxkit/api-client";
import type { PaymentReturn } from "./payment-return";
import { isPaymentId } from "./payment-return";

/**
 * Form-handoff bridge (ADR 0059): the API returns `{ actionUrl, fields }` for a live attempt; this module only POSTs to
 * an allow-listed `https` host. The CSP allows `https://www.liqpay.ua` in `form-action`.
 */

const ALLOWED_HANDOFF_HOSTS = Object.freeze(["www.liqpay.ua"]);

export function isAllowedHandoffActionUrl(raw: string): boolean {
  if (typeof raw !== "string" || raw.length > 2048 || /\s/.test(raw)) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    ALLOWED_HANDOFF_HOSTS.includes(url.hostname)
  );
}

export type HandoffFetch =
  | { kind: "ok"; handoff: PaymentHandoff }
  | { kind: "not_found" }
  | { kind: "unavailable" }
  | { kind: "error" };

export async function fetchPaymentHandoff(
  client: StoreClient,
  entry: PaymentReturn,
  paymentId: string,
): Promise<HandoffFetch> {
  if (!isPaymentId(paymentId) || entry.paymentId !== paymentId) {
    return { kind: "not_found" };
  }
  try {
    const result =
      entry.kind === "guest"
        ? await client.getOrderPaymentHandoff({
            number: entry.number,
            accessToken: entry.accessToken,
            paymentId,
          })
        : await client.getAccountOrderPaymentHandoff(entry.number, paymentId);
    if (!result.ok) {
      if (result.problem.status === 404) return { kind: "not_found" };
      if (result.problem.status === 409 || result.problem.status === 503) {
        return { kind: "unavailable" };
      }
      return { kind: "error" };
    }
    if (!isAllowedHandoffActionUrl(result.data.actionUrl)) {
      return { kind: "error" };
    }
    return { kind: "ok", handoff: result.data };
  } catch {
    return { kind: "error" };
  }
}

/** Builds a form in `document`, fills hidden fields, and submits it. Returns false when the URL is refused. */
export function submitHandoffForm(document: Document, handoff: PaymentHandoff): boolean {
  if (!isAllowedHandoffActionUrl(handoff.actionUrl)) {
    return false;
  }
  const form = document.createElement("form");
  form.method = "POST";
  form.action = handoff.actionUrl;
  form.acceptCharset = "utf-8";
  form.style.display = "none";
  for (const [name, value] of Object.entries(handoff.fields)) {
    if (typeof name !== "string" || typeof value !== "string") continue;
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  return true;
}
