import {
  SECRETS_KEY_BYTES as CONFIG_KEY_BYTES,
  SECRETS_KEY_ID_PATTERN as CONFIG_KEY_ID_PATTERN,
} from "@fluxkit/config";
import { SECRETS_KEY_BYTES, SECRETS_KEY_ID_PATTERN } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import { testSecretsKey } from "../test/integration-provider-fixture.js";
import {
  SecretCipher,
  SecretStorageDisabledError,
  SecretUnavailableError,
  type SealedSecret,
  type SecretBinding,
} from "./secret-cipher.js";

const BINDING: SecretBinding = {
  secretId: "11111111-1111-4111-8111-111111111111",
  integrationId: "22222222-2222-4222-8222-222222222222",
  kind: "email",
  providerCode: "testmail",
  field: "api_key",
  generation: 1,
};
const PLAINTEXT = "tm_SENTINELsecret0123456789";

const flipped = (bytes: Buffer, index = 0): Buffer => {
  const copy = Buffer.from(bytes);
  copy[index] = (copy[index] ?? 0) ^ 0x01;
  return copy;
};

describe("key vocabulary", () => {
  it("is the same in the config package (which parses the variable) and in core (which the schema mirrors)", () => {
    expect(CONFIG_KEY_ID_PATTERN.source).toBe(SECRETS_KEY_ID_PATTERN.source);
    expect(CONFIG_KEY_BYTES).toBe(SECRETS_KEY_BYTES);
  });
});

describe("SecretCipher", () => {
  const k1 = testSecretsKey("k1");
  const k2 = testSecretsKey("k2");
  const cipher = new SecretCipher({ current: k1, previous: null });

  it("round-trips a secret and stores the current key id, a 12-byte nonce and a 16-byte tag", () => {
    const sealed = cipher.seal(BINDING, PLAINTEXT);
    expect(sealed.keyId).toBe("k1");
    expect(sealed.nonce).toHaveLength(12);
    expect(sealed.tag).toHaveLength(16);
    expect(sealed.ciphertext).toHaveLength(Buffer.byteLength(PLAINTEXT));
    expect(sealed.ciphertext.includes(Buffer.from("SENTINEL"))).toBe(false);
    expect(cipher.open(BINDING, sealed)).toBe(PLAINTEXT);
  });

  it("never repeats a nonce and never produces the same envelope twice", () => {
    const nonces = new Set<string>();
    const ciphertexts = new Set<string>();
    for (let index = 0; index < 5000; index += 1) {
      const sealed = cipher.seal(BINDING, PLAINTEXT);
      nonces.add(sealed.nonce.toString("hex"));
      ciphertexts.add(sealed.ciphertext.toString("hex"));
    }
    expect(nonces.size).toBe(5000);
    expect(ciphertexts.size).toBe(5000);
  });

  it.each([
    [
      "the ciphertext",
      (sealed: SealedSecret) => ({ ...sealed, ciphertext: flipped(sealed.ciphertext) }),
    ],
    ["the tag", (sealed: SealedSecret) => ({ ...sealed, tag: flipped(sealed.tag) })],
    ["the nonce", (sealed: SealedSecret) => ({ ...sealed, nonce: flipped(sealed.nonce) })],
    ["a truncated tag", (sealed: SealedSecret) => ({ ...sealed, tag: sealed.tag.subarray(0, 12) })],
    [
      "a short nonce",
      (sealed: SealedSecret) => ({ ...sealed, nonce: sealed.nonce.subarray(0, 8) }),
    ],
    [
      "a truncated ciphertext",
      (sealed: SealedSecret) => ({ ...sealed, ciphertext: sealed.ciphertext.subarray(1) }),
    ],
  ])("refuses an envelope with a changed %s", (_name, change) => {
    const sealed = cipher.seal(BINDING, PLAINTEXT);
    expect(() => cipher.open(BINDING, change(sealed))).toThrow(SecretUnavailableError);
  });

  it.each([
    ["secret row", { secretId: "33333333-3333-4333-8333-333333333333" }],
    ["integration", { integrationId: "33333333-3333-4333-8333-333333333333" }],
    ["kind", { kind: "payment" as const }],
    ["provider", { providerCode: "othermail" }],
    ["field", { field: "webhook_secret" }],
    ["generation", { generation: 2 }],
  ])("refuses an envelope moved to another %s", (_name, change) => {
    const sealed = cipher.seal(BINDING, PLAINTEXT);
    expect(() => cipher.open({ ...BINDING, ...change }, sealed)).toThrow(SecretUnavailableError);
  });

  it("refuses an unknown key id, and a key id relabelled to another key of the ring", () => {
    const ring = new SecretCipher({ current: k2, previous: k1 });
    const sealedUnderK1 = cipher.seal(BINDING, PLAINTEXT);
    expect(() => ring.open(BINDING, { ...sealedUnderK1, keyId: "k9" })).toThrow(
      SecretUnavailableError,
    );
    // Relabelling picks the wrong key AND changes the authenticated key id: both must fail.
    expect(() => ring.open(BINDING, { ...sealedUnderK1, keyId: "k2" })).toThrow(
      SecretUnavailableError,
    );
    expect(ring.open(BINDING, sealedUnderK1)).toBe(PLAINTEXT);
  });

  it("rotation: the previous key opens old envelopes, new ones use the current key, a dropped key strands the old", () => {
    const old = cipher.seal(BINDING, PLAINTEXT);
    const rotating = new SecretCipher({ current: k2, previous: k1 });
    expect(rotating.hasKey("k1")).toBe(true);
    expect(rotating.open(BINDING, old)).toBe(PLAINTEXT);
    const rewrapped = rotating.seal(BINDING, rotating.open(BINDING, old));
    expect(rewrapped.keyId).toBe("k2");
    expect(rewrapped.nonce.equals(old.nonce)).toBe(false);

    const finished = new SecretCipher({ current: k2, previous: null });
    expect(finished.open(BINDING, rewrapped)).toBe(PLAINTEXT);
    expect(finished.hasKey("k1")).toBe(false);
    expect(() => finished.open(BINDING, old)).toThrow(SecretUnavailableError);
  });

  it("the same key bytes under another id do not open an envelope", () => {
    const sealed = cipher.seal(BINDING, PLAINTEXT);
    const renamed = new SecretCipher({
      current: { id: "k1-renamed", bytes: k1.bytes },
      previous: null,
    });
    expect(() => renamed.open(BINDING, { ...sealed, keyId: "k1-renamed" })).toThrow(
      SecretUnavailableError,
    );
  });

  it("without a key ring nothing is sealed or opened", () => {
    const disabled = new SecretCipher(null);
    expect(disabled.isEnabled).toBe(false);
    expect(() => disabled.seal(BINDING, PLAINTEXT)).toThrow(SecretStorageDisabledError);
    expect(() => disabled.open(BINDING, cipher.seal(BINDING, PLAINTEXT))).toThrow(
      SecretUnavailableError,
    );
  });

  it.each(["", "x".repeat(4097)])("refuses a plaintext outside 1 to 4096 bytes", (plaintext) => {
    expect(() => cipher.seal(BINDING, plaintext)).toThrow(RangeError);
  });

  it("says nothing about the secret or the reason when it fails", () => {
    const sealed = cipher.seal(BINDING, PLAINTEXT);
    try {
      cipher.open(BINDING, { ...sealed, tag: flipped(sealed.tag) });
      throw new Error("open did not throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SecretUnavailableError);
      const text = `${(error as Error).message} ${String((error as Error).stack)} ${JSON.stringify(error)}`;
      expect(text).not.toContain("SENTINEL");
      expect((error as Error).cause).toBeUndefined();
    }
  });
});
