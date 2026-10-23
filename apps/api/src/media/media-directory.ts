import { mkdir } from "node:fs/promises";
import type { AppEnv } from "@fluxkit/config";

/**
 * Creates the built-in development default of `MEDIA_DIR` (`<repo>/var/media`, git-ignored) when `MEDIA_DIR` is NOT set,
 * the driver is `local` and `NODE_ENV` is not production, so a fresh checkout, the e2e suites, the feature matrix and
 * `pnpm jobs:run-once` start without a setup step. A `MEDIA_DIR` that is set (always in production) is never created: it
 * must already exist, and the media module fails the start loudly when it does not (ADR 0028 decision 8). Returns the
 * directory it created, if any.
 */
export async function prepareDefaultMediaDirectory(
  config: Pick<AppEnv, "mediaStorageDriver" | "mediaDir">,
  processEnv: Readonly<Record<string, string | undefined>>,
): Promise<string | undefined> {
  if (
    config.mediaStorageDriver !== "local" ||
    config.mediaDir === undefined ||
    processEnv["MEDIA_DIR"] !== undefined ||
    processEnv["NODE_ENV"] === "production"
  ) {
    return undefined;
  }
  await mkdir(config.mediaDir, { recursive: true, mode: 0o750 });
  return config.mediaDir;
}
