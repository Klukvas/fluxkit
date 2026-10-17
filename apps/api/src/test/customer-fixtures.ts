import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../database/database.module.js";
import { customer } from "../database/schema/index.js";

export interface TestCustomer {
  id: string;
  email: string;
}

/**
 * TEST ONLY. Inserts a customer directly. The password hash is a placeholder that matches nothing (sessions are
 * created through the session service); register and login are step 3b. Emails are unique per call.
 */
export async function createTestCustomer(
  db: Database,
  options: { isActive?: boolean; email?: string } = {},
): Promise<TestCustomer> {
  const email = options.email ?? `customer-test-${randomUUID()}@example.test`;
  const [row] = await db
    .insert(customer)
    .values({
      email,
      passwordHash: "scrypt$16$8$1$test$test",
      firstName: "Test",
      lastName: "Customer",
      isActive: options.isActive ?? true,
    })
    .returning({ id: customer.id });
  if (row === undefined) {
    throw new Error("Test setup bug: the customer was not inserted");
  }
  return { id: row.id, email };
}

/** Deletes the customers (their sessions go with them by ON DELETE CASCADE). */
export async function deleteTestCustomers(db: Database, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    await db.delete(customer).where(eq(customer.id, id));
  }
}
