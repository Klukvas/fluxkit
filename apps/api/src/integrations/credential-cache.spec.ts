import { describe, expect, it } from "vitest";
import { CREDENTIAL_CACHE_MAX_AGE_MS, RevisionCache } from "./credential-cache.js";

describe("RevisionCache", () => {
  it("reuses a snapshot only for the same revision inside five seconds", () => {
    const cache = new RevisionCache<string>();
    expect(cache.get(1, 0)).toEqual({ hit: false });
    cache.set(1, 1_000, "secret");
    expect(cache.get(1, 1_000 + CREDENTIAL_CACHE_MAX_AGE_MS - 1)).toEqual({
      hit: true,
      value: "secret",
    });
    expect(cache.get(2, 1_001)).toEqual({ hit: false });
    expect(cache.get(1, 1_000 + CREDENTIAL_CACHE_MAX_AGE_MS)).toEqual({ hit: false });
  });

  it("drops a snapshot immediately", () => {
    const cache = new RevisionCache<string>();
    cache.set(4, 10, "secret");
    cache.clear();
    expect(cache.get(4, 11)).toEqual({ hit: false });
  });
});
