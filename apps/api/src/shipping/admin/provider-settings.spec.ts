import { describe, expect, it } from "vitest";
import { PROVIDER_SETTINGS_LIMITS, providerSettingsErrors } from "./provider-settings.js";

const codes = (value: unknown) =>
  providerSettingsErrors(value).map((error) => `${error.path}:${error.code}`);

describe("providerSettingsErrors", () => {
  it("accepts a bounded plain object of JSON values", () => {
    expect(
      codes({
        senderCityRef: "fake-city-kyiv",
        defaultParcel: { weightGrams: 500, sizes: [10, 20, 30] },
        cashOnDelivery: false,
        note: null,
      }),
    ).toEqual([]);
    expect(codes({})).toEqual([]);
  });

  it("refuses anything but an object", () => {
    for (const value of [null, undefined, [], "text", 5, true]) {
      expect(codes(value), String(value)).toEqual([":not_an_object"]);
    }
  });

  it("refuses keys that are not plain names, __proto__ included", () => {
    const hostile = JSON.parse('{"__proto__": {"x": 1}, "a b": 1, "1st": 2, "ok": 3}') as unknown;
    expect(codes(hostile).sort()).toEqual([
      "1st:invalid_key",
      "__proto__:invalid_key",
      "a b:invalid_key",
    ]);
  });

  it("refuses keys that look like credentials, at any depth", () => {
    expect(
      codes({
        apiKey: "x",
        nested: { Password: "y", deeper: [{ access_token: "z" }] },
        api_key: 1,
      }),
    ).toEqual(
      expect.arrayContaining([
        "apiKey:secret_not_allowed",
        "nested.Password:secret_not_allowed",
        "nested.deeper.0.access_token:secret_not_allowed",
        "api_key:secret_not_allowed",
      ]),
    );
  });

  it("bounds depth, keys, items, string length and total size", () => {
    expect(codes({ a: { b: { c: { d: { e: 1 } } } } })).toEqual([]);
    expect(codes({ a: { b: { c: { d: { e: { f: 1 } } } } } })).toEqual(["a.b.c.d.e:too_deep"]);
    const manyKeys = Object.fromEntries(
      Array.from({ length: PROVIDER_SETTINGS_LIMITS.maxKeysPerObject + 1 }, (_, i) => [
        `k${String(i)}`,
        i,
      ]),
    );
    expect(codes(manyKeys)).toEqual([":too_many_keys"]);
    expect(
      codes({ list: new Array<number>(PROVIDER_SETTINGS_LIMITS.maxArrayItems + 1).fill(1) }),
    ).toEqual(["list:too_many_items"]);
    expect(codes({ text: "x".repeat(PROVIDER_SETTINGS_LIMITS.maxStringLength + 1) })).toEqual([
      "text:too_long",
    ]);
    const big = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [
        `k${String(i)}`,
        "x".repeat(PROVIDER_SETTINGS_LIMITS.maxStringLength),
      ]),
    );
    expect(codes(big)).toEqual([":too_large"]);
  });

  it("refuses text Postgres JSONB cannot store", () => {
    expect(codes({ text: "a\u0000b" })).toEqual(["text:unsafe_text"]);
  });
});
