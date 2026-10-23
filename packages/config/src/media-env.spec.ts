import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadEnv } from "./index.js";

const SECRET = "s".repeat(32);
const development = { DATABASE_URL: "postgres://x" };
const production = {
  DATABASE_URL: "postgres://x",
  NODE_ENV: "production",
  ORDER_TOKEN_SECRET: SECRET,
};
const productionLocal = {
  ...production,
  MEDIA_STORAGE_DRIVER: "local",
  MEDIA_DIR: "/srv/fluxkit/media",
  MEDIA_PUBLIC_BASE_URL: "https://shop.example.com/media",
};

/** A copy of `source` without one key (the omitted value is not needed, so no unused variable). */
function without(source: Record<string, string>, key: string): Record<string, string> {
  return Object.fromEntries(Object.entries(source).filter(([name]) => name !== key));
}

/** The repository root, found differently from production code (path segments instead of a relative URL). */
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("loadEnv media: defaults outside production", () => {
  it.each([undefined, "development", "test", "staging"])(
    "NODE_ENV %j uses local storage in <repo>/var/media",
    (nodeEnv) => {
      const env = loadEnv({
        ...development,
        ...(nodeEnv === undefined ? {} : { NODE_ENV: nodeEnv }),
      });
      expect(env.mediaStorageDriver).toBe("local");
      expect(env.mediaDir).toBe(resolve(repositoryRoot, "var", "media"));
      expect(env.mediaPublicBaseUrl).toBe("http://127.0.0.1:3000/media");
      expect(env.mediaMaxBytes).toBe(10 * 1024 * 1024);
      expect(env.mediaMaxPixels).toBe(50_000_000);
    },
  );

  it("makes the default base URL follow a custom PORT", () => {
    expect(loadEnv({ ...development, PORT: "4123" }).mediaPublicBaseUrl).toBe(
      "http://127.0.0.1:4123/media",
    );
    expect(loadEnv({ ...development, PORT: "80" }).mediaPublicBaseUrl).toBe(
      "http://127.0.0.1:80/media",
    );
  });

  it("does not follow PORT when the base URL is given", () => {
    const env = loadEnv({
      ...development,
      PORT: "4123",
      MEDIA_PUBLIC_BASE_URL: "http://localhost:9/media",
    });
    expect(env.mediaPublicBaseUrl).toBe("http://localhost:9/media");
  });

  it("does not touch the file system: a default directory that does not exist is accepted", () => {
    expect(loadEnv(development).mediaDir).toContain("var");
  });
});

describe("loadEnv media: MEDIA_STORAGE_DRIVER", () => {
  it.each(["local", "none"])("accepts %j", (driver) => {
    expect(loadEnv({ ...development, MEDIA_STORAGE_DRIVER: driver }).mediaStorageDriver).toBe(
      driver,
    );
  });

  it.each(["s3", "LOCAL", "None", " local", "local ", "", "disk", "true", "0", "local,none"])(
    "refuses %j and names the variable",
    (driver) => {
      expect(() => loadEnv({ ...development, MEDIA_STORAGE_DRIVER: driver })).toThrow(
        /MEDIA_STORAGE_DRIVER/,
      );
      expect(() => loadEnv({ ...productionLocal, MEDIA_STORAGE_DRIVER: driver })).toThrow(
        /MEDIA_STORAGE_DRIVER/,
      );
    },
  );

  it("is required in production: no silent fallback to local", () => {
    const withoutDriver = without(productionLocal, "MEDIA_STORAGE_DRIVER");
    expect(() => loadEnv(withoutDriver)).toThrow(/MEDIA_STORAGE_DRIVER.*production/);
    expect(() => loadEnv(production)).toThrow(/MEDIA_STORAGE_DRIVER/);
  });

  it.each(["production", "Production", " PRODUCTION "])(
    "is required when NODE_ENV is %j",
    (nodeEnv) => {
      expect(() => loadEnv({ ...production, NODE_ENV: nodeEnv })).toThrow(/MEDIA_STORAGE_DRIVER/);
    },
  );

  it("none in production needs no directory and no base URL, and leaves them unset (no prefix to protect)", () => {
    const env = loadEnv({ ...production, MEDIA_STORAGE_DRIVER: "none" });
    expect(env.mediaStorageDriver).toBe("none");
    expect(env.mediaDir).toBeUndefined();
    expect(env.mediaPublicBaseUrl).toBeUndefined();
  });

  it("none in production keeps a given base URL, so attach marking still protects uploads under it (review M-2)", () => {
    const url = "https://shop.example.test/media";
    const env = loadEnv({
      ...production,
      MEDIA_STORAGE_DRIVER: "none",
      MEDIA_PUBLIC_BASE_URL: url,
    });
    expect(env.mediaPublicBaseUrl).toBe(url);
  });

  it("none outside production leaves the directory unset but resolves the base URL like local (review M-2)", () => {
    // Uploads made earlier with `local` live under the development default prefix; attach marking must still see them.
    const env = loadEnv({ ...development, MEDIA_STORAGE_DRIVER: "none" });
    expect(env.mediaDir).toBeUndefined();
    expect(env.mediaPublicBaseUrl).toBe("http://127.0.0.1:3000/media");
    expect(
      loadEnv({ ...development, MEDIA_STORAGE_DRIVER: "none", PORT: "4123" }).mediaPublicBaseUrl,
    ).toBe("http://127.0.0.1:4123/media");
    expect(
      loadEnv({
        ...development,
        MEDIA_STORAGE_DRIVER: "none",
        MEDIA_PUBLIC_BASE_URL: "http://localhost:9/media",
      }).mediaPublicBaseUrl,
    ).toBe("http://localhost:9/media");
  });

  it("still validates a directory or base URL given with none (a typo must fail loudly)", () => {
    expect(() =>
      loadEnv({ ...development, MEDIA_STORAGE_DRIVER: "none", MEDIA_DIR: "relative" }),
    ).toThrow(/MEDIA_DIR/);
    expect(() =>
      loadEnv({ ...development, MEDIA_STORAGE_DRIVER: "none", MEDIA_PUBLIC_BASE_URL: "nope" }),
    ).toThrow(/MEDIA_PUBLIC_BASE_URL/);
  });
});

describe("loadEnv media: MEDIA_DIR", () => {
  it("is required with local in production", () => {
    const withoutDir = without(productionLocal, "MEDIA_DIR");
    expect(() => loadEnv(withoutDir)).toThrow(/MEDIA_DIR.*required/);
  });

  it("takes an absolute path and returns it normalized", () => {
    expect(loadEnv({ ...productionLocal, MEDIA_DIR: "/srv/fluxkit/media" }).mediaDir).toBe(
      "/srv/fluxkit/media",
    );
    expect(loadEnv({ ...productionLocal, MEDIA_DIR: "/srv/fluxkit/media/" }).mediaDir).toBe(
      "/srv/fluxkit/media",
    );
    expect(loadEnv({ ...productionLocal, MEDIA_DIR: "/srv/a/../fluxkit//media" }).mediaDir).toBe(
      "/srv/fluxkit/media",
    );
    expect(loadEnv({ ...development, MEDIA_DIR: "/tmp/media" }).mediaDir).toBe("/tmp/media");
  });

  it.each([
    "var/media",
    "./media",
    "../media",
    "~/media",
    "media",
    " /srv/media",
    "$HOME/media",
    "file:///srv/media",
    "/srv/me\0dia",
    "/",
    "",
  ])("refuses %j", (directory) => {
    expect(() => loadEnv({ ...development, MEDIA_DIR: directory })).toThrow(/MEDIA_DIR/);
    expect(() => loadEnv({ ...productionLocal, MEDIA_DIR: directory })).toThrow(/MEDIA_DIR/);
  });
});

describe("loadEnv media: MEDIA_PUBLIC_BASE_URL", () => {
  it.each([
    "http://127.0.0.1:3000/media",
    "http://localhost:8080/media",
    "https://shop.example.com/media",
    "https://media.shop.example.com",
    "https://cdn.example.com/a/b",
    "https://shop.example.com:8443/media",
    "https://[::1]:3000/media",
  ])("accepts %s outside production", (url) => {
    expect(loadEnv({ ...development, MEDIA_PUBLIC_BASE_URL: url }).mediaPublicBaseUrl).toBe(url);
  });

  it.each([
    "https://shop.example.com/media",
    "https://media.shop.example.com",
    "https://cdn.example.com:8443/a/b",
  ])("accepts %s in production", (url) => {
    expect(loadEnv({ ...productionLocal, MEDIA_PUBLIC_BASE_URL: url }).mediaPublicBaseUrl).toBe(
      url,
    );
  });

  it.each([
    "http://shop.example.com/media",
    "http://127.0.0.1:3000/media",
    "http://localhost/media",
  ])("requires https in production: %s is refused", (url) => {
    expect(() => loadEnv({ ...productionLocal, MEDIA_PUBLIC_BASE_URL: url })).toThrow(
      /MEDIA_PUBLIC_BASE_URL.*https/,
    );
  });

  it("requires https in production also when the driver is none and a URL is given", () => {
    expect(() =>
      loadEnv({
        ...production,
        MEDIA_STORAGE_DRIVER: "none",
        MEDIA_PUBLIC_BASE_URL: "http://a.example.com/media",
      }),
    ).toThrow(/MEDIA_PUBLIC_BASE_URL/);
  });

  it("is required with local in production: no localhost default there", () => {
    const withoutUrl = without(productionLocal, "MEDIA_PUBLIC_BASE_URL");
    expect(() => loadEnv(withoutUrl)).toThrow(/MEDIA_PUBLIC_BASE_URL.*required/);
  });

  it.each([
    "",
    "media",
    "/media",
    "//shop.example.com/media",
    "http://",
    "https:///media",
    "ftp://shop.example.com/media",
    "javascript:alert(1)",
    "data:text/plain,x",
    "file:///media",
    "https://shop.example.com/media/",
    "https://shop.example.com/",
    "https://shop.example.com/media//",
    "https://user:pass@shop.example.com/media",
    "https://user@shop.example.com/media",
    "https://:pass@shop.example.com/media",
    "https://shop.example.com/media?x=1",
    "https://shop.example.com/media?",
    "https://shop.example.com/media#top",
    "https://shop.example.com/media#",
    " https://shop.example.com/media",
    "https://shop.example.com/media ",
    "https://shop.example.com/me dia",
    "https://shop.example.com/media\n",
    "HTTPS://shop.example.com/media",
    "https://Shop.Example.com/media",
    "https://shop.example.com:443/media",
    "http://shop.example.com:80/media",
    "https://shop.example.com/x/../media",
    "https://shop.example.com/./media",
  ])("refuses %j", (url) => {
    expect(() => loadEnv({ ...development, MEDIA_PUBLIC_BASE_URL: url })).toThrow(
      /MEDIA_PUBLIC_BASE_URL/,
    );
  });
});

describe("loadEnv media: MEDIA_MAX_BYTES and MEDIA_MAX_PIXELS", () => {
  it.each(["1024", "2048", "10485760", "52428800"])("accepts MEDIA_MAX_BYTES %s", (value) => {
    expect(loadEnv({ ...development, MEDIA_MAX_BYTES: value }).mediaMaxBytes).toBe(Number(value));
  });

  it.each([
    "1023",
    "1",
    "0",
    "52428801",
    "99999999999",
    "-2048",
    "+2048",
    "1e6",
    "0x400",
    "1 024",
    " 2048",
    "2048 ",
    "10.5",
    "",
    "010485760",
    "1_024",
    "٢٠٤٨",
  ])("refuses MEDIA_MAX_BYTES %j", (value) => {
    expect(() => loadEnv({ ...development, MEDIA_MAX_BYTES: value })).toThrow(/MEDIA_MAX_BYTES/);
  });

  it.each(["1", "50000000", "100000000"])("accepts MEDIA_MAX_PIXELS %s", (value) => {
    expect(loadEnv({ ...development, MEDIA_MAX_PIXELS: value }).mediaMaxPixels).toBe(Number(value));
  });

  it.each([
    "0",
    "100000001",
    "-1",
    "+5",
    "1e6",
    "0x10",
    "5 ",
    " 5",
    "1.5",
    "",
    "007",
    "9".repeat(400),
  ])("refuses MEDIA_MAX_PIXELS %j", (value) => {
    expect(() => loadEnv({ ...development, MEDIA_MAX_PIXELS: value })).toThrow(/MEDIA_MAX_PIXELS/);
  });

  it("applies in production as well", () => {
    expect(
      loadEnv({ ...productionLocal, MEDIA_MAX_BYTES: "2048", MEDIA_MAX_PIXELS: "100" }),
    ).toMatchObject({
      mediaMaxBytes: 2048,
      mediaMaxPixels: 100,
    });
  });
});

describe("loadEnv media: error messages", () => {
  function message(source: Record<string, string | undefined>): string {
    try {
      loadEnv(source);
    } catch (error) {
      return String(error);
    }
    return expect.unreachable("loadEnv should have thrown");
  }

  it("never echoes credentials from the base URL", () => {
    const text = message({
      ...development,
      MEDIA_PUBLIC_BASE_URL: "https://admin:hunter2-secret@shop.example.com/media",
    });
    expect(text).toContain("MEDIA_PUBLIC_BASE_URL");
    expect(text).not.toContain("hunter2-secret");
    expect(text).not.toContain("admin:");
  });

  it("never echoes the base URL or directory it refuses", () => {
    expect(
      message({
        ...development,
        MEDIA_PUBLIC_BASE_URL: "https://shop.example.com/media?token=abc123",
      }),
    ).not.toContain("abc123");
    expect(message({ ...development, MEDIA_DIR: "relative/secret-dir-name" })).not.toContain(
      "secret-dir-name",
    );
  });

  it("names every media variable that is wrong, with the other errors", () => {
    const text = message({
      ...development,
      MEDIA_STORAGE_DRIVER: "s3",
      MEDIA_MAX_BYTES: "1",
      MEDIA_MAX_PIXELS: "0",
    });
    expect(text).toMatch(/MEDIA_STORAGE_DRIVER/);
    expect(text).toMatch(/MEDIA_MAX_BYTES/);
    expect(text).toMatch(/MEDIA_MAX_PIXELS/);
  });

  it("does not echo the order token secret in a media error either", () => {
    const text = message({
      ...productionLocal,
      ORDER_TOKEN_SECRET: "abc-secret-value-that-is-long-enough-1234",
      MEDIA_MAX_BYTES: "x",
    });
    expect(text).not.toContain("abc-secret-value");
  });
});
