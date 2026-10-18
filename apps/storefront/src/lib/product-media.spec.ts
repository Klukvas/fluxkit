import { describe, expect, it } from "vitest";
import { galleryFor, prepareMedia } from "./product-media";

const hosts = ["cdn.example.com"];

describe("prepareMedia", () => {
  it("keeps the order, gives an allowed image its URL and any other a null source (the placeholder)", () => {
    const result = prepareMedia(
      [
        { url: "https://cdn.example.com/a.jpg", alt: "Front", optionValueId: null },
        { url: "https://example.com/placeholder/b.jpg", alt: null, optionValueId: "value-1" },
      ],
      hosts,
    );
    expect(result).toEqual([
      { src: "https://cdn.example.com/a.jpg", alt: "Front", optionValueId: null },
      { src: null, alt: null, optionValueId: "value-1" },
    ]);
  });
});

describe("galleryFor", () => {
  const items = [
    { src: "a", alt: "general", optionValueId: null },
    { src: "b", alt: "red", optionValueId: "value-red" },
    { src: "c", alt: "blue", optionValueId: "value-blue" },
    { src: "d", alt: "general 2", optionValueId: null },
  ];

  it("puts media of the selected option values first, then general media, then the rest, each in API order", () => {
    expect(galleryFor(items, ["value-red"]).map((item) => item.src)).toEqual(["b", "a", "d", "c"]);
    expect(galleryFor(items, ["value-blue", "value-red"]).map((item) => item.src)).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
  });

  it("shows general media before option-specific media when nothing is selected or nothing matches", () => {
    expect(galleryFor(items, []).map((item) => item.src)).toEqual(["a", "d", "b", "c"]);
    expect(galleryFor(items, ["value-green"]).map((item) => item.src)).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
  });

  it("returns one placeholder entry for a product without media, so the page always has an image slot", () => {
    expect(galleryFor([], [])).toEqual([{ src: null, alt: null, optionValueId: null }]);
  });

  it("does not mutate its input", () => {
    const frozen = Object.freeze([...items]);
    expect(() => galleryFor(frozen, ["value-red"])).not.toThrow();
  });
});
