import { defineConfig } from "drizzle-kit";

// The blog feature's own migrations (ADR 0049); run from this folder (`pnpm --filter @fluxkit/feature-blog db:generate`).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  // DRIZZLE_KIT_OUT is only for scripts/check-schema-drift.sh, which generates into a temporary copy.
  out: process.env.DRIZZLE_KIT_OUT ?? "./drizzle",
});
