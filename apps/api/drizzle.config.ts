import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/database/schema/index.ts",
  // DRIZZLE_KIT_OUT is only for scripts/check-schema-drift.sh, which generates into a temporary copy.
  out: process.env.DRIZZLE_KIT_OUT ?? "./drizzle",
});
