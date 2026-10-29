// Runs once after the last test: removes the temp upload directory that `prepare-database.ts` created for this run. The path is
// fixed (`ADMIN_E2E_MEDIA_DIR`), so a run that crashed before this point leaves a directory that the next run wipes at its start.
import { rmSync } from "node:fs";
import { ADMIN_E2E_MEDIA_DIR } from "./support/env.ts";
import { removeSearchKeyAndIndexes } from "./support/search-engine.ts";

export default async function globalTeardown(): Promise<void> {
  rmSync(ADMIN_E2E_MEDIA_DIR, { recursive: true, force: true });
  console.log(`admin e2e: removed ${ADMIN_E2E_MEDIA_DIR}`);
  // The scoped search key and the indexes of this suite's prefix; a crashed run leaves them for the next start to remove.
  await removeSearchKeyAndIndexes(process.env);
  console.log("admin e2e: removed the search key and the search indexes");
}
