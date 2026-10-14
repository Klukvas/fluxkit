import { integer, pgTable, timestamp } from "drizzle-orm/pg-core";

/** Throwaway table for the migration spike (plan step 5). Remove once real domain tables exist. */
export const healthCheck = pgTable("health_check", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
});
