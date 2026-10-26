export const ROLES = Object.freeze(["owner", "manager", "viewer"] as const);
export const PERMISSIONS = Object.freeze([
  "catalog.read",
  "catalog.write",
  "catalog.publish",
  "users.manage",
  "orders.read",
  "orders.write",
  "customers.read",
  "customers.write",
  "shipping.manage",
  "email.manage",
] as const);

export type AdminRole = (typeof ROLES)[number];
export type AdminPermission = (typeof PERMISSIONS)[number];

// Fixed in code on purpose (ADR 0009): a new role is a code change plus a test, not data.
// Orders and customers hold personal data, so the viewer gets neither (ADR 0017); the manager gets all four.
// Shipping settings (methods, rates, provider profiles) are shop configuration: owner and manager, not the viewer (ADR 0029 decision 13).
// Mail delivery (status, test send, outbox with recipient addresses, resend, cancel, preview): owner and manager; addresses are personal data (ADR 0031 decision 15).
export const ROLE_PERMISSIONS: Readonly<Record<AdminRole, readonly AdminPermission[]>> =
  Object.freeze({
    owner: Object.freeze([...PERMISSIONS]),
    manager: Object.freeze([
      "catalog.read",
      "catalog.write",
      "catalog.publish",
      "orders.read",
      "orders.write",
      "customers.read",
      "customers.write",
      "shipping.manage",
      "email.manage",
    ] as const),
    viewer: Object.freeze(["catalog.read"] as const),
  });

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function isAdminPermission(value: unknown): value is AdminPermission {
  return typeof value === "string" && (PERMISSIONS as readonly string[]).includes(value);
}

/** A frozen copy, so a caller can never change the table through the result. Unknown roles get nothing. */
export function permissionsOf(role: string): readonly AdminPermission[] {
  // Own-property check through the validated list: "__proto__", "constructor" and friends are not roles.
  if (!isAdminRole(role) || !Object.hasOwn(ROLE_PERMISSIONS, role)) {
    return Object.freeze([]);
  }
  return Object.freeze([...ROLE_PERMISSIONS[role]]);
}

export function hasPermission(role: string, permission: string): boolean {
  if (!isAdminRole(role) || !isAdminPermission(permission)) {
    return false;
  }
  return ROLE_PERMISSIONS[role].includes(permission);
}
