import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../database/database.module.js";
import { customer } from "../database/schema/index.js";
import { testPasswordHasher } from "./admin-user-fixtures.js";

export interface TestCustomer {
  id: string;
  email: string;
  /** The clear-text password, only set when the fixture was asked to create a real hash (`password` option). */
  password?: string;
}

/**
 * TEST ONLY. Inserts a customer directly. Without `password` the hash is a placeholder that matches nothing
 * (sessions are then created through the session service); with it the hash is real (the cheap test scrypt
 * parameters), so the customer can sign in. Emails are unique per call.
 */
export async function createTestCustomer(
  db: Database,
  options: { isActive?: boolean; email?: string; password?: string } = {},
): Promise<TestCustomer> {
  const email = options.email ?? `customer-test-${randomUUID()}@example.test`;
  const [row] = await db
    .insert(customer)
    .values({
      email,
      passwordHash:
        options.password === undefined
          ? "scrypt$16$8$1$test$test"
          : await testPasswordHasher.hash(options.password),
      firstName: "Test",
      lastName: "Customer",
      isActive: options.isActive ?? true,
    })
    .returning({ id: customer.id });
  if (row === undefined) {
    throw new Error("Test setup bug: the customer was not inserted");
  }
  return {
    id: row.id,
    email,
    ...(options.password === undefined ? {} : { password: options.password }),
  };
}

/** Deletes the customers (their sessions go with them by ON DELETE CASCADE). */
export async function deleteTestCustomers(db: Database, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    await db.delete(customer).where(eq(customer.id, id));
  }
}
