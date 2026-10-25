import type { AdminOperationName } from "@fluxkit/api-client";
import { canRun } from "../../permissions";
import { useSession } from "../../session/session-context";

/**
 * Every write the shipping settings screens can make, by the API operation. A write control is rendered only when the
 * signed-in admin may run ALL of them (one permission today, shipping.manage; naming the operations keeps the screens
 * following `ADMIN_OPERATIONS` if the API splits them). The routes themselves need shipping.manage already (the viewer
 * never reaches them); the API decides anyway and a 403 is shown.
 */
export const SHIPPING_WRITE_OPERATIONS = [
  "createShippingMethod",
  "updateShippingMethod",
  "deleteShippingMethod",
  "putShippingProviderSettings",
  "checkShippingProvider",
] as const satisfies readonly AdminOperationName[];

export function canManageShipping(permissions: readonly string[] | null): boolean {
  return SHIPPING_WRITE_OPERATIONS.every((operation) => canRun(permissions, operation));
}

export function useCanManageShipping(): boolean {
  const session = useSession();
  return canManageShipping(session.state.me?.permissions ?? null);
}
