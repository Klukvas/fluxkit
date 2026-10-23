import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareDefaultMediaDirectory } from "./media-directory.js";

describe("prepareDefaultMediaDirectory", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "fluxkit-media-default-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("creates the development default (mode 0750) when MEDIA_DIR is not set", async () => {
    const mediaDir = join(root, "var", "media");
    expect(await prepareDefaultMediaDirectory({ mediaStorageDriver: "local", mediaDir }, {})).toBe(
      mediaDir,
    );
    expect((await stat(mediaDir)).mode & 0o777).toBe(0o750);
  });

  it("never creates a MEDIA_DIR that was set, nor anything in production or with the none driver", async () => {
    const mediaDir = join(root, "configured");
    for (const [config, processEnv] of [
      [{ mediaStorageDriver: "local", mediaDir }, { MEDIA_DIR: mediaDir }],
      [{ mediaStorageDriver: "local", mediaDir }, { NODE_ENV: "production" }],
      [{ mediaStorageDriver: "none", mediaDir }, {}],
      [{ mediaStorageDriver: "local", mediaDir: undefined }, {}],
    ] as const) {
      expect(await prepareDefaultMediaDirectory(config, processEnv)).toBeUndefined();
    }
    await expect(stat(mediaDir)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
