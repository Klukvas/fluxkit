import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AdminRole } from "@fluxkit/core";
import type { Database } from "../database/database.module.js";
import { adminUser } from "../database/schema/index.js";

export interface TestAdminUser {
  id: string;
  email: string;
  role: AdminRole;
}

/**
 * TEST ONLY. Inserts an admin user directly (there is no user endpoint yet). The password hash is a placeholder:
 * sessions are created through the session service, not through login. Emails are unique per call.
 */
export async function createTestAdminUser(
  db: Database,
  options: { role?: AdminRole; isActive?: boolean } = {},
): Promise<TestAdminUser> {
  const email = `auth-test-${randomUUID()}@example.test`;
  const [row] = await db
    .insert(adminUser)
    .values({
      email,
      passwordHash: "scrypt$16$8$1$test$test",
      role: options.role ?? "viewer",
      isActive: options.isActive ?? true,
    })
    .returning({ id: adminUser.id, role: adminUser.role });
  if (row === undefined) {
    throw new Error("Test setup bug: the admin user was not inserted");
  }
  return { id: row.id, email, role: row.role as AdminRole };
}

/** Deletes the users (their sessions go with them by ON DELETE CASCADE). */
export async function deleteTestAdminUsers(db: Database, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    await db.delete(adminUser).where(eq(adminUser.id, id));
  }
}
