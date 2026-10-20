import { describe, expect, it } from "vitest";
import {
  LOCALE_STORAGE_KEY,
  detectLocale,
  initialLocale,
  readStoredLocale,
  storeLocale,
  type StorageLike,
} from "./locale-preference";

function memoryStorage(initial: Record<string, string> = {}): StorageLike & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const throwing = (): StorageLike => {
  throw new DOMException("denied", "SecurityError");
};

describe("detectLocale", () => {
  it("picks the first supported browser language and falls back to uk", () => {
    expect(detectLocale(["en-US", "uk"])).toBe("en");
    expect(detectLocale(["de-DE", "uk-UA"])).toBe("uk");
    expect(detectLocale(["de-DE", "fr"])).toBe("uk");
    expect(detectLocale([])).toBe("uk");
  });
});

describe("stored UI language", () => {
  it("is read and written under one key, as the language code only", () => {
    const storage = memoryStorage();
    expect(storeLocale(() => storage, "en")).toBe(true);
    expect(storage.data).toEqual({ [LOCALE_STORAGE_KEY]: "en" });
    expect(readStoredLocale(() => storage)).toBe("en");
  });

  it("ignores a stored value that is not a supported language", () => {
    expect(readStoredLocale(() => memoryStorage({ [LOCALE_STORAGE_KEY]: "de" }))).toBeNull();
  });

  it("works without storage (private mode, blocked site data): nothing is stored, nothing throws", () => {
    expect(readStoredLocale(throwing)).toBeNull();
    expect(storeLocale(throwing, "en")).toBe(false);
    const failingWrite: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    };
    expect(storeLocale(() => failingWrite, "en")).toBe(false);
  });

  it("prefers the stored choice over the browser language", () => {
    const storage = memoryStorage({ [LOCALE_STORAGE_KEY]: "en" });
    expect(initialLocale(() => storage, ["uk-UA"])).toBe("en");
    expect(initialLocale(() => memoryStorage(), ["en-GB"])).toBe("en");
    expect(initialLocale(throwing, ["en-GB"])).toBe("en");
  });
});
