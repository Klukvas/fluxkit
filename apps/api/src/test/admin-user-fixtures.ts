import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AdminRole } from "@fluxkit/core";
import { PasswordHasher } from "../auth/password-hasher.js";
import type { Database } from "../database/database.module.js";
import { adminUser } from "../database/schema/index.js";
import { TEST_SCRYPT_PARAMS } from "./app.js";

export interface TestAdminUser {
  id: string;
  email: string;
  role: AdminRole;
  /** The clear-text password, only set when the fixture was asked to create a real hash (`password` option). */
  password?: string;
}

/** The same cheap scrypt parameters the test app uses, so a login against a fixture user needs no rehash. */
export const testPasswordHasher = new PasswordHasher(TEST_SCRYPT_PARAMS);

/**
 * TEST ONLY. Inserts an admin user directly. Without `password` the hash is a placeholder that matches nothing
 * (sessions are then created through the session service); with it the hash is real, so the user can log in.
 * Emails are unique per call.
 */
export async function createTestAdminUser(
  db: Database,
  options: {
    role?: AdminRole;
    isActive?: boolean;
    password?: string;
    passwordHash?: string;
  } = {},
): Promise<TestAdminUser> {
  const email = `auth-test-${randomUUID()}@example.test`;
  const passwordHash =
    options.passwordHash ??
    (options.password === undefined
      ? "scrypt$16$8$1$test$test"
      : await testPasswordHasher.hash(options.password));
  const [row] = await db
    .insert(adminUser)
    .values({
      email,
      passwordHash,
      role: options.role ?? "viewer",
      isActive: options.isActive ?? true,
    })
    .returning({ id: adminUser.id, role: adminUser.role });
  if (row === undefined) {
    throw new Error("Test setup bug: the admin user was not inserted");
  }
  return {
    id: row.id,
    email,
    role: row.role as AdminRole,
    ...(options.password === undefined ? {} : { password: options.password }),
  };
}

/** Deletes the users (their sessions go with them by ON DELETE CASCADE). */
export async function deleteTestAdminUsers(db: Database, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    await db.delete(adminUser).where(eq(adminUser.id, id));
  }
}
