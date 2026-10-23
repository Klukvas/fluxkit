// Runs once after the last test: removes the temp upload directory that `prepare-database.ts` created for this run. The path is
// fixed (`E2E_MEDIA_DIR`), so a run that crashed before this point leaves a directory that the next run wipes at its start.
import { rmSync } from "node:fs";
import { E2E_MEDIA_DIR } from "./support/env.ts";

export default function globalTeardown(): void {
  rmSync(E2E_MEDIA_DIR, { recursive: true, force: true });
  console.log(`e2e: removed ${E2E_MEDIA_DIR}`);
}
