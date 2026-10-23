import { describe, expect, it } from "vitest";
import {
  contentTypeOf,
  extensionOf,
  generateMediaKey,
  isMediaKey,
  keyToRelativePath,
  typeOfKey,
} from "./key.js";
import { ALLOWED_IMAGE_TYPES } from "./image-types.js";
import { seededRandom, toHex } from "./test-support.js";

const HEX = "0123456789abcdef";
const VALID = "3f2a9c0d1b7e4f6a8c5d2e1f00aabbcc.webp";

function randomHexKey(random: () => number, extension: string): string {
  let hex = "";
  for (let index = 0; index < 32; index += 1) {
    hex += HEX[Math.floor(random() * 16)];
  }
  return `${hex}.${extension}`;
}

describe("the allowed image types", () => {
  it("maps each type to one extension and one content type", () => {
    expect(extensionOf("jpeg")).toBe("jpg");
    expect(extensionOf("png")).toBe("png");
    expect(extensionOf("webp")).toBe("webp");
    expect(contentTypeOf("jpeg")).toBe("image/jpeg");
    expect(contentTypeOf("png")).toBe("image/png");
    expect(contentTypeOf("webp")).toBe("image/webp");
  });

  it("lists exactly jpeg, png and webp, and is frozen", () => {
    expect(Object.keys(ALLOWED_IMAGE_TYPES)).toEqual(["jpeg", "png", "webp"]);
    expect(Object.isFrozen(ALLOWED_IMAGE_TYPES)).toBe(true);
    expect(Object.isFrozen(ALLOWED_IMAGE_TYPES.jpeg)).toBe(true);
  });

  it("refuses a type that is not on the list", () => {
    expect(() => extensionOf("gif" as never)).toThrow(RangeError);
    expect(() => contentTypeOf("svg" as never)).toThrow(RangeError);
    expect(() => extensionOf("constructor" as never)).toThrow(RangeError);
    expect(() => contentTypeOf("__proto__" as never)).toThrow(RangeError);
  });
});

describe("isMediaKey", () => {
  it.each(["jpg", "png", "webp"])("accepts 32 lower-case hex digits and .%s", (extension) => {
    expect(isMediaKey(`00000000000000000000000000000000.${extension}`)).toBe(true);
    expect(isMediaKey(`ffffffffffffffffffffffffffffffff.${extension}`)).toBe(true);
    expect(isMediaKey(`0123456789abcdef0123456789abcdef.${extension}`)).toBe(true);
  });

  it("accepts a valid key", () => {
    expect(isMediaKey(VALID)).toBe(true);
  });

  it("accepts 1000 seeded valid keys", () => {
    const random = seededRandom(7);
    for (let round = 0; round < 1000; round += 1) {
      expect(isMediaKey(randomHexKey(random, ["jpg", "png", "webp"][round % 3] ?? "jpg"))).toBe(
        true,
      );
    }
  });

  it.each([
    undefined,
    null,
    0,
    42,
    true,
    {},
    [],
    [VALID],
    { toString: () => VALID },
    Symbol("key"),
    () => VALID,
  ])("refuses a value that is not a string: %s", (value) => {
    expect(isMediaKey(value)).toBe(false);
  });

  it("refuses the hand-picked traps", () => {
    const hex = "3f2a9c0d1b7e4f6a8c5d2e1f00aabbcc";
    const traps = [
      "",
      ".",
      "..",
      "../",
      "../etc/passwd",
      `../${VALID}`,
      `..%2f${VALID}`,
      `%2e%2e/${VALID}`,
      `%2e%2e%2f${VALID}`,
      `${hex}%2ewebp`,
      `${hex}.%77ebp`,
      `/${VALID}`,
      `${VALID}/`,
      `3f/2a/${VALID}`,
      `3f\\2a\\${VALID}`,
      `..\\${VALID}`,
      `${VALID}\n`,
      `\n${VALID}`,
      ` ${VALID}`,
      `${VALID} `,
      `${VALID}\0`,
      `${hex}\0.webp`,
      `${hex}.webp\0.jpg`,
      `${hex}.webp.jpg`,
      `${hex}.jpg.webp`,
      `${hex}..webp`,
      `${hex}webp`,
      `${hex}.`,
      hex,
      `.${hex}.webp`,
      `${hex.toUpperCase()}.webp`,
      `${hex}.WEBP`,
      `${hex}.Webp`,
      `${hex}.JPG`,
      `${hex}.jpeg`,
      `${hex}.gif`,
      `${hex}.svg`,
      `${hex}.avif`,
      `${hex}.html`,
      `${hex}.php`,
      `${hex.slice(1)}.webp`,
      `${hex}0.webp`,
      `${hex}g.webp`.slice(1),
      `${hex.slice(0, 31)}g.webp`,
      `${hex.slice(0, 31)}G.webp`,
      `${hex.slice(0, 31)}-.webp`,
      `${hex.slice(0, 31)}_.webp`,
      `${hex.slice(0, 31)} .webp`,
      `${hex.slice(0, 31)}٣.webp`, // Arabic-Indic digit three
      `${hex.slice(0, 31)}３.webp`, // fullwidth digit three
      `${hex.slice(0, 31)}ａ.webp`, // fullwidth a
      `${hex.slice(0, 31)}а.webp`, // Cyrillic a
      `${hex.slice(0, 30)}\u{1d7d1}.webp`.slice(0, 40), // mathematical digit
      `${hex}.weбp`,
      `${VALID}${String.fromCharCode(0x200b)}`, // zero-width space
      `${String.fromCharCode(0xfeff)}${VALID}`, // byte order mark
      `${hex}.webp?x=1`,
      `${hex}.webp#frag`,
      `${hex}.webp;.jpg`,
      "http://host/" + VALID,
      "file:///" + VALID,
    ];
    for (const trap of traps) {
      expect(isMediaKey(trap), JSON.stringify(trap)).toBe(false);
    }
  });

  it("refuses 1000 seeded invalid keys (mutations of a valid key)", () => {
    const random = seededRandom(0xbadc0de);
    const alphabet = [
      "/",
      "\\",
      ".",
      "%",
      "\0",
      "\n",
      " ",
      "G",
      "Z",
      "-",
      "٣",
      "３",
      "а",
      "é",
      "\u{1f600}",
      "A",
      "F",
    ];
    const base = "3f2a9c0d1b7e4f6a8c5d2e1f00aabbcc";
    let counted = 0;
    while (counted < 1000) {
      const kind = Math.floor(random() * 5);
      let candidate: string;
      const insert = alphabet[Math.floor(random() * alphabet.length)] ?? "/";
      const position = Math.floor(random() * (base.length + 1));
      if (kind === 0) {
        // one forbidden character replacing a hex digit
        const at = Math.min(position, base.length - 1);
        candidate = `${base.slice(0, at)}${insert}${base.slice(at + 1)}.webp`;
      } else if (kind === 1) {
        // one forbidden character inserted (so the length is also wrong)
        candidate = `${base.slice(0, position)}${insert}${base.slice(position)}.png`;
      } else if (kind === 2) {
        // wrong length of hex
        const length = [0, 1, 16, 31, 33, 40, 64][Math.floor(random() * 7)] ?? 0;
        candidate = `${base.repeat(3).slice(0, length)}.jpg`;
      } else if (kind === 3) {
        // wrong or decorated extension
        const extension =
          [".jpeg", ".JPG", ".gif", ".webp.", ".webp.png", "", ".", ".w", ".webpx", ".exe"][
            Math.floor(random() * 10)
          ] ?? "";
        candidate = `${base}${extension}`;
      } else {
        // a valid key wrapped in a path, query or traversal
        const wrapper =
          ["../", "./", "/", "a/", "%2e%2e/", "..\\", "x/../"][Math.floor(random() * 7)] ?? "/";
        candidate = `${wrapper}${base}.webp${random() < 0.5 ? "" : "/"}`;
      }
      if (/^[0-9a-f]{32}\.(jpg|png|webp)$/.test(candidate)) {
        continue; // the mutation produced a valid key; not an invalid sample
      }
      counted += 1;
      expect(isMediaKey(candidate), JSON.stringify(candidate)).toBe(false);
    }
  });

  it("narrows its argument to MediaKey", () => {
    const value: unknown = VALID;
    if (isMediaKey(value)) {
      const key: string = value;
      expect(keyToRelativePath(value)).toBe(`3f/2a/${key}`);
    } else {
      expect.unreachable();
    }
  });
});

describe("keyToRelativePath", () => {
  it("shards by the first two and the next two hex digits", () => {
    expect(keyToRelativePath(VALID)).toBe(`3f/2a/${VALID}`);
    expect(keyToRelativePath("00000000000000000000000000000000.jpg")).toBe(
      "00/00/00000000000000000000000000000000.jpg",
    );
  });

  it("always stays three plain segments without traversal, for seeded keys", () => {
    const random = seededRandom(99);
    for (let round = 0; round < 1000; round += 1) {
      const key = randomHexKey(random, "png");
      const path = keyToRelativePath(key);
      const parts = path.split("/");
      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe(key.slice(0, 2));
      expect(parts[1]).toBe(key.slice(2, 4));
      expect(parts[2]).toBe(key);
      expect(path).not.toContain("..");
      expect(path.startsWith("/")).toBe(false);
    }
  });

  it.each([
    "../x",
    `..%2f${VALID}`,
    `/${VALID}`,
    `${VALID}\0`,
    VALID.toUpperCase(),
    "",
    "a/b/c.png",
  ])("throws for %j instead of building a path from it", (value) => {
    expect(() => keyToRelativePath(value)).toThrow(RangeError);
  });
});

describe("typeOfKey", () => {
  it("returns the type the extension names", () => {
    expect(typeOfKey("00000000000000000000000000000000.jpg")).toBe("jpeg");
    expect(typeOfKey("00000000000000000000000000000000.png")).toBe("png");
    expect(typeOfKey("00000000000000000000000000000000.webp")).toBe("webp");
  });

  it("throws for a string that is not a key", () => {
    expect(() => typeOfKey("0.jpg")).toThrow(RangeError);
  });
});

describe("generateMediaKey", () => {
  const sixteen = Uint8Array.from([
    0x3f, 0x2a, 0x9c, 0x0d, 0x1b, 0x7e, 0x4f, 0x6a, 0x8c, 0x5d, 0x2e, 0x1f, 0x00, 0xaa, 0xbb, 0xcc,
  ]);

  it("asks the injected source for exactly 16 bytes and returns hex plus the extension", () => {
    const requested: number[] = [];
    const key = generateMediaKey((size) => {
      requested.push(size);
      return sixteen;
    }, "webp");
    expect(requested).toEqual([16]);
    expect(key).toBe(VALID);
    expect(isMediaKey(key)).toBe(true);
  });

  it("uses the extension of the output type", () => {
    expect(generateMediaKey(() => sixteen, "jpeg").endsWith(".jpg")).toBe(true);
    expect(generateMediaKey(() => sixteen, "png").endsWith(".png")).toBe(true);
    expect(generateMediaKey(() => sixteen, "webp").endsWith(".webp")).toBe(true);
  });

  it("produces a valid key for seeded random sources, and the hex is the bytes", () => {
    const random = seededRandom(5);
    for (let round = 0; round < 1000; round += 1) {
      const data = Uint8Array.from({ length: 16 }, () => Math.floor(random() * 256));
      const key = generateMediaKey(() => data, "png");
      expect(isMediaKey(key)).toBe(true);
      expect(key).toBe(`${toHex(data)}.png`);
    }
  });

  it.each([0, 1, 8, 15, 17, 32])("rejects a source that returns %i bytes", (length) => {
    expect(() => generateMediaKey(() => new Uint8Array(length), "png")).toThrow(/exactly 16 bytes/);
  });

  it("rejects a source that returns something that is not bytes", () => {
    expect(() => generateMediaKey((() => undefined) as never, "png")).toThrow(RangeError);
    expect(() => generateMediaKey((() => "0123456789abcdef") as never, "png")).toThrow(RangeError);
    expect(() => generateMediaKey((() => new Array(16).fill(1)) as never, "png")).toThrow(
      RangeError,
    );
  });

  it("does not catch a failing source", () => {
    expect(() =>
      generateMediaKey(() => {
        throw new Error("entropy unavailable");
      }, "png"),
    ).toThrow("entropy unavailable");
  });

  it("rejects an output type that is not on the list", () => {
    expect(() => generateMediaKey(() => sixteen, "gif" as never)).toThrow(RangeError);
  });
});
