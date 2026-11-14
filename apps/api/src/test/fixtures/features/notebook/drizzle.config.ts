import { defineConfig } from "drizzle-kit";

// Test fixture only: the shape of a feature's drizzle config (ADR 0049). Run from this folder.
export default defineConfig({
  dialect: "postgresql",
  schema: "./schema.ts",
  // DRIZZLE_KIT_OUT is only for scripts/check-schema-drift.sh, which generates into a temporary copy.
  out: process.env.DRIZZLE_KIT_OUT ?? "./drizzle",
});
