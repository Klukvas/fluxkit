import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SCRYPT_PARAMS, PasswordHasher } from "./password-hasher.js";

// Cheap parameters keep the suite fast; the default (production) parameters are exercised once below.
const CHEAP = { N: 16, r: 8, p: 1 } as const;
const hasher = new PasswordHasher(CHEAP);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PasswordHasher", () => {
  it("hashes to scrypt$N$r$p$salt$hash with a 16-byte salt and a 64-byte key", async () => {
    const stored = await hasher.hash("correct horse battery staple");
    const parts = stored.split("$");
    expect(parts).toHaveLength(6);
    expect(parts.slice(0, 4)).toEqual(["scrypt", "16", "8", "1"]);
    expect(Buffer.from(parts[4] ?? "", "base64")).toHaveLength(16);
    expect(Buffer.from(parts[5] ?? "", "base64")).toHaveLength(64);
    expect(stored).not.toContain("correct horse");
  });

  it("uses N=32768 r=8 p=1 by default and the memory limit allows it", async () => {
    expect(DEFAULT_SCRYPT_PARAMS).toEqual({ N: 32768, r: 8, p: 1 });
    const production = new PasswordHasher();
    const stored = await production.hash("default parameters");
    expect(stored.startsWith("scrypt$32768$8$1$")).toBe(true);
    expect(production.needsRehash(stored)).toBe(false);
    expect(await production.verify("default parameters", stored)).toBe(true);
  });

  it("round trip: the right password verifies, a wrong one does not", async () => {
    const stored = await hasher.hash("correct horse battery staple");
    expect(await hasher.verify("correct horse battery staple", stored)).toBe(true);
    expect(await hasher.verify("correct horse battery stapl", stored)).toBe(false);
    expect(await hasher.verify("", stored)).toBe(false);
    expect(await hasher.verify("Correct horse battery staple", stored)).toBe(false);
  });

  it("uses a different salt (and so a different string) for the same password", async () => {
    const [first, second] = [
      await hasher.hash("same password"),
      await hasher.hash("same password"),
    ];
    expect(first).not.toBe(second);
    expect(first.split("$")[4]).not.toBe(second.split("$")[4]);
    expect(await hasher.verify("same password", first)).toBe(true);
    expect(await hasher.verify("same password", second)).toBe(true);
  });

  it("rejects a tampered hash, salt or parameter", async () => {
    const stored = await hasher.hash("tamper me please");
    const parts = stored.split("$");
    const flip = (value: string): string => `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
    const tamperedHash = [...parts.slice(0, 5), flip(parts[5] ?? "")].join("$");
    const tamperedSalt = [...parts.slice(0, 4), flip(parts[4] ?? ""), parts[5]].join("$");
    const otherCost = ["scrypt", "32", "8", "1", parts[4], parts[5]].join("$");
    for (const bad of [tamperedHash, tamperedSalt, otherCost]) {
      expect(await hasher.verify("tamper me please", bad)).toBe(false);
    }
  });

  it("reads the parameters from the stored string, not from the instance", async () => {
    const weak = await new PasswordHasher({ N: 4, r: 1, p: 1 }).hash("portable");
    expect(await hasher.verify("portable", weak)).toBe(true);
    const strong = await new PasswordHasher({ N: 32, r: 8, p: 2 }).hash("portable");
    expect(await hasher.verify("portable", strong)).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["no separators", "plaintext-password"],
    ["wrong algorithm", "bcrypt$16$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA"],
    ["too few parts", "scrypt$16$8$1$AAAAAAAAAAAAAAAAAAAAAA=="],
    ["too many parts", "scrypt$16$8$1$a$b$c"],
    ["non numeric N", "scrypt$abc$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA"],
    ["N not a power of two", "scrypt$15$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA"],
    ["zero r", "scrypt$16$0$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA"],
    ["negative p", "scrypt$16$8$-1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA"],
    ["enormous N (memory attack)", "scrypt$1073741824$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA"],
    ["not base64", "scrypt$16$8$1$!!!!$????"],
    ["short salt", "scrypt$16$8$1$AAAA$AAAA"],
  ])("returns false (never throws) for a malformed stored value: %s", async (_name, stored) => {
    await expect(hasher.verify("anything", stored)).resolves.toBe(false);
    expect(hasher.needsRehash(stored)).toBe(true);
  });

  it("returns false for a stored value that is not a string or a password that is not a string", async () => {
    await expect(hasher.verify("x", undefined as unknown as string)).resolves.toBe(false);
    await expect(hasher.verify("x", null as unknown as string)).resolves.toBe(false);
    const stored = await hasher.hash("x");
    await expect(hasher.verify(undefined as unknown as string, stored)).resolves.toBe(false);
  });

  it("detects hashes that need a rehash", async () => {
    const current = await hasher.hash("rehash me");
    expect(hasher.needsRehash(current)).toBe(false);
    expect(new PasswordHasher({ N: 32, r: 8, p: 1 }).needsRehash(current)).toBe(true);
    expect(new PasswordHasher({ N: 16, r: 16, p: 1 }).needsRehash(current)).toBe(true);
    expect(new PasswordHasher({ N: 16, r: 8, p: 2 }).needsRehash(current)).toBe(true);
  });

  it("handles unicode passwords (no normalization, exact UTF-8 bytes)", async () => {
    for (const password of [
      "Пароль-для-адміна-123",
      "密码密码密码密码密码密码",
      "p@ss 🔐🔐🔐 word",
      "é",
    ]) {
      const stored = await hasher.hash(password);
      expect(await hasher.verify(password, stored)).toBe(true);
    }
    const composed = await hasher.hash("é");
    expect(await hasher.verify("é", composed)).toBe(false);
  });

  it("compares with crypto.timingSafeEqual", async () => {
    const stored = await hasher.hash("constant time");
    const compare = vi.spyOn(crypto, "timingSafeEqual");
    await hasher.verify("constant time", stored);
    await hasher.verify("not it", stored);
    expect(compare).toHaveBeenCalledTimes(2);
  });

  it("verifyDummy always answers false and takes about as long as a real verification", async () => {
    const stored = await hasher.hash("real");
    expect(await hasher.verifyDummy("real")).toBe(false);
    const slow = new PasswordHasher({ N: 16384, r: 8, p: 1 });
    const slowStored = await slow.hash("real");
    const time = async (run: () => Promise<unknown>): Promise<number> => {
      const started = performance.now();
      await run();
      return performance.now() - started;
    };
    const verifyTimes = [await time(() => slow.verify("x", slowStored))];
    const dummyTimes = [await time(() => slow.verifyDummy("x"))];
    for (let i = 0; i < 2; i += 1) {
      verifyTimes.push(await time(() => slow.verify("x", slowStored)));
      dummyTimes.push(await time(() => slow.verifyDummy("x")));
    }
    // Not a timing oracle test (too flaky); it proves the dummy path does real scrypt work.
    expect(Math.min(...dummyTimes)).toBeGreaterThan(Math.min(...verifyTimes) * 0.3);
    expect(await slow.verify("real", slowStored)).toBe(true);
    expect(stored).toBeTypeOf("string");
  });
});
