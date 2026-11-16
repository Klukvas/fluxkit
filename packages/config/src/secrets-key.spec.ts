import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadEnv, parseSecretsKeyVariable } from "./index.js";

const base = { DATABASE_URL: "postgres://x" };
const keyOf = (id: string, bytes = randomBytes(32)): string => `${id}:${bytes.toString("base64")}`;

function messageOf(source: Record<string, string | undefined>): string {
  try {
    loadEnv(source);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("loadEnv did not throw");
}

describe("parseSecretsKeyVariable", () => {
  it("reads the id and exactly 32 bytes", () => {
    const bytes = randomBytes(32);
    const parsed = parseSecretsKeyVariable(keyOf("2026-11_a", bytes));
    expect(parsed).toEqual({ ok: true, key: { id: "2026-11_a", bytes: new Uint8Array(bytes) } });
  });

  it.each([
    ["no separator", randomBytes(32).toString("base64")],
    ["an empty id", `:${randomBytes(32).toString("base64")}`],
    ["an id with a space", `a b:${randomBytes(32).toString("base64")}`],
    ["an id of 33 characters", keyOf("a".repeat(33))],
    ["31 bytes", `k1:${randomBytes(31).toString("base64")}`],
    ["33 bytes", `k1:${randomBytes(33).toString("base64")}`],
    ["url-safe base64", `k1:${"-".repeat(43)}=`],
    ["missing padding", `k1:${randomBytes(32).toString("base64").slice(0, 43)}`],
    ["a non-canonical last character", `k1:${"A".repeat(42)}B=`],
    ["a passphrase", "k1:correct horse battery staple"],
    ["surrounding spaces", ` ${keyOf("k1")} `],
  ])("refuses %s without showing the value", (_name, raw) => {
    const parsed = parseSecretsKeyVariable(raw);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.problem).toContain("the value is not shown");
      expect(parsed.problem).not.toContain(raw.trim().slice(3, 20));
    }
  });
});

describe("loadEnv: SECRETS_ENCRYPTION_KEY", () => {
  it("has no key ring when neither variable is set, blank included", () => {
    expect(loadEnv(base).secretsKeyRing).toBeNull();
    expect(
      loadEnv({ ...base, SECRETS_ENCRYPTION_KEY: " ", SECRETS_ENCRYPTION_KEY_PREVIOUS: "" })
        .secretsKeyRing,
    ).toBeNull();
  });

  it("loads the current key alone", () => {
    const ring = loadEnv({ ...base, SECRETS_ENCRYPTION_KEY: keyOf("k2") }).secretsKeyRing;
    expect(ring?.current.id).toBe("k2");
    expect(ring?.current.bytes).toHaveLength(32);
    expect(ring?.previous).toBeNull();
  });

  it("loads the current and the previous key", () => {
    const ring = loadEnv({
      ...base,
      SECRETS_ENCRYPTION_KEY: keyOf("k2"),
      SECRETS_ENCRYPTION_KEY_PREVIOUS: keyOf("k1"),
    }).secretsKeyRing;
    expect(ring?.current.id).toBe("k2");
    expect(ring?.previous?.id).toBe("k1");
  });

  it("refuses a malformed current key and names only the variable", () => {
    const message = messageOf({ ...base, SECRETS_ENCRYPTION_KEY: "k1:not-a-key-SENTINEL" });
    expect(message).toContain("SECRETS_ENCRYPTION_KEY: must be <key-id>:<base64>");
    expect(message).not.toContain("SENTINEL");
  });

  it("refuses a malformed previous key", () => {
    const message = messageOf({
      ...base,
      SECRETS_ENCRYPTION_KEY: keyOf("k2"),
      SECRETS_ENCRYPTION_KEY_PREVIOUS: "k1:SENTINEL",
    });
    expect(message).toContain("SECRETS_ENCRYPTION_KEY_PREVIOUS: must be <key-id>:<base64>");
    expect(message).not.toContain("SENTINEL");
  });

  it("refuses a previous key without a current one", () => {
    expect(messageOf({ ...base, SECRETS_ENCRYPTION_KEY_PREVIOUS: keyOf("k1") })).toContain(
      "SECRETS_ENCRYPTION_KEY_PREVIOUS: needs SECRETS_ENCRYPTION_KEY",
    );
  });

  it("refuses two keys with one id", () => {
    expect(
      messageOf({
        ...base,
        SECRETS_ENCRYPTION_KEY: keyOf("k1"),
        SECRETS_ENCRYPTION_KEY_PREVIOUS: keyOf("k1"),
      }),
    ).toContain("SECRETS_ENCRYPTION_KEY_PREVIOUS: must have a different key id");
  });

  it("refuses the same bytes under two ids", () => {
    const bytes = randomBytes(32);
    expect(
      messageOf({
        ...base,
        SECRETS_ENCRYPTION_KEY: keyOf("k2", bytes),
        SECRETS_ENCRYPTION_KEY_PREVIOUS: keyOf("k1", bytes),
      }),
    ).toContain("SECRETS_ENCRYPTION_KEY_PREVIOUS: must be a different key");
  });
});
