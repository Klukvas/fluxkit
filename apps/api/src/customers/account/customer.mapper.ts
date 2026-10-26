import type { CustomerRow } from "../customer.repository.js";
import type { CustomerResponse } from "./account.schemas.js";

/**
 * Database row -> what a customer may see of their own account. Fields are copied one by one (an allow list), so a
 * column added to `customer` later (the password hash above all) can never leak by accident.
 */
export function toCustomerResponse(row: CustomerRow): CustomerResponse {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.emailVerifiedAt !== null,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    createdAt: row.createdAt.toISOString(),
  };
}
