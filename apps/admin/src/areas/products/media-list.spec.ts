import type { AdminProductMedia } from "@fluxkit/api-client";
import { TEXT_LIMITS } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import {
  ALT_MAX_LENGTH,
  MAX_MEDIA,
  addMedia,
  mediaBody,
  mediaDirty,
  mediaRowsFrom,
  moveMedia,
  newMediaRow,
  pairKey,
  removeMedia,
  removedMediaCount,
  setMediaLink,
  updateMedia,
  validateMedia,
  type MediaRow,
} from "./media-list";

const locales = ["uk", "en"];
const context = {
  defaultLocale: "uk",
  locales,
  chosenPairs: new Set([pairKey("opt-a", "val-1"), pairKey("opt-a", "val-2")]),
};

function stored(
  id: string,
  position: number,
  overrides: Partial<AdminProductMedia> = {},
): AdminProductMedia {
  return {
    id,
    url: `https://img.example/${id}.jpg`,
    alt: null,
    position,
    optionId: null,
    optionValueId: null,
    createdAt: "2026-10-20T10:00:00.000Z",
    updatedAt: "2026-10-20T10:00:00.000Z",
    ...overrides,
  };
}

const three = (): MediaRow[] =>
  mediaRowsFrom(
    [
      stored("c", 7),
      stored("a", 0, { alt: { uk: "Перше", en: "First", de: "Erste" } }),
      stored("b", 3, { optionId: "opt-a", optionValueId: "val-1" }),
    ],
    locales,
  );

describe("media rows from the product", () => {
  it("are in stored position order, one alt field per content locale, the option pair kept", () => {
    const rows = three();
    expect(rows.map((row) => row.key)).toEqual(["a", "b", "c"]);
    expect(rows[0]?.alt).toEqual({ uk: "Перше", en: "First" });
    expect(rows[1]).toMatchObject({ optionId: "opt-a", optionValueId: "val-1" });
    expect(rows[2]?.alt).toEqual({ uk: "", en: "" });
  });

  it("the API's own limits are the ones the model uses", () => {
    expect(ALT_MAX_LENGTH).toBe(TEXT_LIMITS.alt);
    expect(MAX_MEDIA).toBe(100);
  });
});

describe("editing the list", () => {
  it("adds an empty row at the end, never beyond 100", () => {
    const rows = addMedia(three(), newMediaRow("new-1", locales));
    expect(rows.map((row) => row.key)).toEqual(["a", "b", "c", "new-1"]);
    expect(rows[3]).toEqual({
      key: "new-1",
      url: "",
      alt: { uk: "", en: "" },
      optionId: null,
      optionValueId: null,
    });
    const full = Array.from({ length: MAX_MEDIA }, (_, index) => newMediaRow(`n${index}`, locales));
    expect(addMedia(full, newMediaRow("over", locales))).toBe(full);
  });

  it("removes exactly the row at the index", () => {
    expect(removeMedia(three(), 1).map((row) => row.key)).toEqual(["a", "c"]);
    const rows = three();
    expect(removeMedia(rows, 5)).toBe(rows);
  });

  it("moves a row one place up or down, and does nothing past either end", () => {
    expect(moveMedia(three(), 1, -1).map((row) => row.key)).toEqual(["b", "a", "c"]);
    expect(moveMedia(three(), 1, 1).map((row) => row.key)).toEqual(["a", "c", "b"]);
    expect(moveMedia(three(), 0, 1).map((row) => row.key)).toEqual(["b", "a", "c"]);
    expect(moveMedia(three(), 2, -1).map((row) => row.key)).toEqual(["a", "c", "b"]);
    const rows = three();
    expect(moveMedia(rows, 0, -1)).toBe(rows);
    expect(moveMedia(rows, 2, 1)).toBe(rows);
  });

  it("changes one row's address or alt text and links or unlinks an option value as a pair", () => {
    const rows = updateMedia(three(), 2, { url: "https://img.example/new.jpg" });
    expect(rows[2]?.url).toBe("https://img.example/new.jpg");
    expect(rows[0]?.url).toBe("https://img.example/a.jpg");
    const alt = updateMedia(rows, 0, { alt: { uk: "Нове", en: "" } });
    expect(alt[0]?.alt).toEqual({ uk: "Нове", en: "" });
    const linked = setMediaLink(alt, 2, { optionId: "opt-a", optionValueId: "val-2" });
    expect(linked[2]).toMatchObject({ optionId: "opt-a", optionValueId: "val-2" });
    expect(setMediaLink(linked, 2, null)[2]).toMatchObject({
      optionId: null,
      optionValueId: null,
    });
  });
});

describe("checks before the save", () => {
  it("accepts the stored list", () => {
    expect(validateMedia(three(), context)).toEqual({});
  });

  it("refuses an empty, relative, non-http or over-long address on that row", () => {
    const at = (url: string) =>
      validateMedia(updateMedia(three(), 1, { url }), context)["media.1.url"];
    expect(at("")).toEqual({ key: "errors.reason.required" });
    expect(at("   ")).toEqual({ key: "errors.reason.required" });
    expect(at("/img/a.jpg")).toEqual({ key: "products.media.urlInvalid" });
    expect(at("javascript:alert(1)")).toEqual({ key: "products.media.urlInvalid" });
    expect(at("data:image/png;base64,AAAA")).toEqual({ key: "products.media.urlInvalid" });
    expect(at("ftp://img.example/a.jpg")).toEqual({ key: "products.media.urlInvalid" });
    expect(at("//img.example/a.jpg")).toEqual({ key: "products.media.urlInvalid" });
    expect(at("https://user:pw@img.example/a.jpg")).toEqual({ key: "products.media.urlInvalid" });
    expect(at(`https://img.example/${"a".repeat(2048)}`)).toEqual({
      key: "products.media.urlInvalid",
    });
    expect(at("  https://img.example/ok.jpg  ")).toBeUndefined();
    expect(at("http://img.example/ok.jpg")).toBeUndefined();
  });

  it("refuses an alt text longer than 255 characters (code points) in its locale", () => {
    const issues = validateMedia(
      updateMedia(three(), 0, { alt: { uk: "ї".repeat(255), en: "x".repeat(256) } }),
      context,
    );
    expect(issues["media.0.alt.uk"]).toBeUndefined();
    expect(issues["media.0.alt.en"]).toEqual({
      key: "products.media.altTooLong",
      values: { max: 255 },
    });
  });

  it("asks for the default locale once any alt text is given (core validateI18nText); none at all is fine", () => {
    const only = validateMedia(
      updateMedia(three(), 2, { alt: { uk: "", en: "Only English" } }),
      context,
    );
    expect(only["media.2.alt.uk"]).toEqual({ key: "errors.reason.default_locale_missing" });
    expect(validateMedia(updateMedia(three(), 2, { alt: { uk: " ", en: " " } }), context)).toEqual(
      {},
    );
  });

  it("refuses an option value the product has not chosen", () => {
    const issues = validateMedia(
      setMediaLink(three(), 2, { optionId: "opt-a", optionValueId: "val-9" }),
      context,
    );
    expect(issues["media.2.optionValueId"]).toEqual({ key: "products.media.linkNotChosen" });
  });

  it("refuses more than 100 rows", () => {
    const rows = Array.from({ length: MAX_MEDIA + 1 }, (_, index) => ({
      ...newMediaRow(`n${index}`, locales),
      url: "https://img.example/x.jpg",
    }));
    expect(validateMedia(rows, context)["media"]).toEqual({
      key: "products.media.tooMany",
      values: { max: MAX_MEDIA },
    });
  });
});

describe("the whole-list PUT body", () => {
  it("sends every row in the shown order with its position, trimmed address, alt map or null, and the pair", () => {
    const rows = moveMedia(
      updateMedia(three(), 2, { url: "  https://img.example/c2.jpg " }),
      2,
      -1,
    );
    expect(mediaBody(rows, locales)).toEqual({
      media: [
        {
          url: "https://img.example/a.jpg",
          alt: { uk: "Перше", en: "First" },
          position: 0,
          optionId: null,
          optionValueId: null,
        },
        {
          url: "https://img.example/c2.jpg",
          alt: null,
          position: 1,
          optionId: null,
          optionValueId: null,
        },
        {
          url: "https://img.example/b.jpg",
          alt: null,
          position: 2,
          optionId: "opt-a",
          optionValueId: "val-1",
        },
      ],
    });
  });

  it("an empty list removes every image", () => {
    expect(mediaBody([], locales)).toEqual({ media: [] });
  });

  it("is dirty after any change that changes the body, and clean again when undone", () => {
    const initial = three();
    expect(mediaDirty(initial, three(), locales)).toBe(false);
    expect(mediaDirty(initial, moveMedia(initial, 0, 1), locales)).toBe(true);
    expect(mediaDirty(initial, moveMedia(moveMedia(initial, 0, 1), 1, -1), locales)).toBe(false);
    expect(mediaDirty(initial, removeMedia(initial, 2), locales)).toBe(true);
    expect(
      mediaDirty(initial, updateMedia(initial, 0, { alt: { uk: "x", en: "" } }), locales),
    ).toBe(true);
    expect(mediaDirty(initial, setMediaLink(initial, 1, null), locales)).toBe(true);
    expect(mediaDirty(initial, addMedia(initial, newMediaRow("n", locales)), locales)).toBe(true);
  });
});

describe("removals on save (confirmed before the PUT)", () => {
  it("counts the stored images the list no longer has; moving or adding removes nothing", () => {
    const initial = three();
    expect(removedMediaCount(initial, initial)).toBe(0);
    expect(removedMediaCount(initial, moveMedia(initial, 0, 1))).toBe(0);
    expect(removedMediaCount(initial, addMedia(initial, newMediaRow("n", locales)))).toBe(0);
    expect(removedMediaCount(initial, removeMedia(removeMedia(initial, 0), 0))).toBe(2);
    const added = addMedia(initial, newMediaRow("n", locales));
    expect(removedMediaCount(initial, removeMedia(added, 3))).toBe(0);
  });
});
