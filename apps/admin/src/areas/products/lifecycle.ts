import type { AdminOperationName, ProductStatus } from "@fluxkit/api-client";
import { canRun } from "../../permissions";

/**
 * The lifecycle of a product (ADR 0006 section 6; `docs/api/catalog.md`, Products): publish (draft to active), unpublish
 * (active to draft), archive (draft or active), restore (archived to draft), and delete for a product that was never
 * published. Which actions the screen OFFERS is a hint from core's rules (compared in the spec); the API decides and its
 * refusal is explained. Pure.
 */
export const LIFECYCLE_ACTIONS = ["publish", "unpublish", "archive", "restore", "delete"] as const;
export type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number];

export const LIFECYCLE_OPERATIONS: Record<LifecycleAction, AdminOperationName> = {
  publish: "publishProduct",
  unpublish: "unpublishProduct",
  archive: "archiveProduct",
  restore: "restoreProduct",
  delete: "deleteProduct",
};

/** How an action is confirmed: not at all, a confirmation, or a danger confirmation (plan, "Confirmation dialogs"). */
export const LIFECYCLE_CONFIRMATION: Record<LifecycleAction, "none" | "default" | "danger"> = {
  publish: "none",
  unpublish: "default",
  archive: "default",
  restore: "none",
  delete: "danger",
};

const BY_STATUS: Record<ProductStatus, readonly LifecycleAction[]> = {
  draft: ["publish", "archive"],
  active: ["unpublish", "archive"],
  archived: ["restore"],
};

export function lifecycleActions(product: {
  status: ProductStatus;
  publishedAt: string | null;
}): LifecycleAction[] {
  return [
    ...BY_STATUS[product.status],
    ...(product.publishedAt === null ? (["delete"] as const) : []),
  ];
}

/** The actions of the product the session may run. */
export function permittedActions(
  product: { status: ProductStatus; publishedAt: string | null },
  permissions: readonly string[] | null,
): LifecycleAction[] {
  return lifecycleActions(product).filter((action) =>
    canRun(permissions, LIFECYCLE_OPERATIONS[action]),
  );
}
