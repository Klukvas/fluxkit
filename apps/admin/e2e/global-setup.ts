// Runs once after the web servers are up (Playwright starts them before `globalSetup`): the owner that
// `prepare-database.ts` created signs in through the proxy and creates the manager and the viewer through the users API,
// exactly as an owner would. The database was wiped at the start of this run, so both are always new.
import { request } from "@playwright/test";
import { AdminApi } from "./support/api.ts";
import { clearStepUpLimits } from "./support/step-up-limits.ts";
import {
  ADMIN_E2E_ORIGIN,
  MANAGER_EMAIL,
  MANAGER_PASSWORD,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  VIEWER_EMAIL,
  VIEWER_PASSWORD,
  clientMarker,
} from "./support/env.ts";

export default async function globalSetup(): Promise<void> {
  // Before any scenario asks for a password again: the limits of an earlier run would still count (`integrations.e2e.ts`).
  const cleared = await clearStepUpLimits(process.env);
  console.log(`admin e2e: cleared ${String(cleared)} step-up limit keys of this database`);
  const context = await request.newContext({
    baseURL: ADMIN_E2E_ORIGIN,
    extraHTTPHeaders: { "x-e2e-client": clientMarker("global-setup", 0, 0) },
  });
  try {
    const owner = await AdminApi.signIn(context, OWNER_EMAIL, OWNER_PASSWORD);
    await owner.createUser(MANAGER_EMAIL, "manager", MANAGER_PASSWORD);
    await owner.createUser(VIEWER_EMAIL, "viewer", VIEWER_PASSWORD);
    await owner.logout();
  } finally {
    await context.dispose();
  }
  console.log("admin e2e: manager and viewer created through the users API");
}
