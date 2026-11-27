import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("built operator rewrap entry", () => {
  it.each([
    ["", "", "integration_rewrap_current_key_required"],
    ["current-placeholder", "", "integration_rewrap_previous_key_required"],
    ["hostile-secret-sentinel", "hostile-previous-sentinel", "integration_rewrap_keys_invalid"],
  ])("refuses unavailable keys with exit 1 and a code only", (current, previous, code) => {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("../../dist/integrations/rewrap.js", import.meta.url))],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          SECRETS_ENCRYPTION_KEY: current,
          SECRETS_ENCRYPTION_KEY_PREVIOUS: previous,
        },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`${code}\n`);
  });
});
