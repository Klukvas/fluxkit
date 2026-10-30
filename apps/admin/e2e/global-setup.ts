// Runs once after the web servers are up (Playwright starts them before `globalSetup`): the owner that
// `prepare-database.ts` created signs in through the proxy and creates the manager and the viewer through the users API,
// exactly as an owner would. The database was wiped at the start of this run, so both are always new.
import { request } from "@playwright/test";
import { AdminApi } from "./support/api.ts";
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
