import { describe, expect, it } from "vitest";
import { sniffImageType } from "./sniff.js";
import {
  ascii,
  bytes,
  fixture,
  jpegFixture,
  pngFixture,
  seededRandom,
  toHex,
  webpFixture,
} from "./test-support.js";

describe("sniffImageType: accepted formats", () => {
  it.each([0xe0, 0xe1, 0xee, 0xdb, 0xc0, 0xc2, 0xc4, 0xfe])(
    "recognizes a JPEG whose first marker is 0x%s",
    (marker) => {
      expect(sniffImageType(jpegFixture(marker))).toBe("jpeg");
    },
  );

  it("recognizes a PNG (signature and IHDR)", () => {
    expect(sniffImageType(pngFixture())).toBe("png");
  });

  it.each(["VP8 ", "VP8L", "VP8X"])("recognizes a WebP whose first chunk is %j", (chunk) => {
    expect(sniffImageType(webpFixture(chunk))).toBe("webp");
  });

  it("looks only at the start: bytes after the prefix never matter", () => {
    const withTail = (head: Uint8Array) => {
      const copy = new Uint8Array(4096).fill(0x3c);
      copy.set(head.subarray(0, 16));
      return copy;
    };
    expect(sniffImageType(withTail(jpegFixture()))).toBe("jpeg");
    expect(sniffImageType(withTail(pngFixture()))).toBe("png");
    expect(sniffImageType(withTail(webpFixture()))).toBe("webp");
  });

  it("accepts a view into a larger buffer", () => {
    const backing = new Uint8Array(100);
    backing.set(pngFixture().subarray(0, 32), 10);
    expect(sniffImageType(backing.subarray(10))).toBe("png");
    expect(sniffImageType(backing)).toBeNull();
  });

  it("does not modify its input", () => {
    const input = pngFixture();
    const copy = Uint8Array.from(input);
    sniffImageType(input);
    expect(input).toEqual(copy);
  });
});

describe("sniffImageType: everything else is null", () => {
  const refused: Record<string, Uint8Array> = {
    SVG: Uint8Array.from(ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>')),
    "SVG with an XML prolog": Uint8Array.from(ascii('<?xml version="1.0"?><svg/>')),
    HTML: Uint8Array.from(ascii("<!DOCTYPE html><html><script>alert(1)</script></html>")),
    "HTML starting with a space": Uint8Array.from(ascii(" <html></html>")),
    GIF87a: Uint8Array.from(ascii("GIF87a\x01\x00\x01\x00")),
    GIF89a: Uint8Array.from(ascii("GIF89a\x01\x00\x01\x00")),
    AVIF: fixture([[0, 0, 0, 0x1c], ascii("ftypavif"), [0, 0, 0, 0], ascii("mif1avif")], 64),
    HEIC: fixture([[0, 0, 0, 0x18], ascii("ftypheic"), [0, 0, 0, 0], ascii("mif1heic")], 64),
    "TIFF little endian": fixture([[0x49, 0x49, 0x2a, 0x00, 0x08, 0, 0, 0]], 64),
    "TIFF big endian": fixture([[0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 0x08]], 64),
    BMP: fixture([ascii("BM"), [0x36, 0x00, 0x0c, 0x00]], 64),
    ICO: fixture([[0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10]], 64),
    PDF: Uint8Array.from(ascii("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")),
    ZIP: fixture([[0x50, 0x4b, 0x03, 0x04]], 64),
    "WAV (RIFF but not WEBP)": fixture([ascii("RIFF"), [0x24, 0, 0, 0], ascii("WAVEfmt ")], 64),
    "AVI (RIFF but not WEBP)": fixture([ascii("RIFF"), [0x24, 0, 0, 0], ascii("AVI LIST")], 64),
    "WebP with an unknown first chunk": webpFixture("EXIF"),
    "WEBP at the wrong offset": fixture(
      [ascii("RIFF"), [0x1a, 0, 0, 0], [0, 0, 0, 0], ascii("WEBPVP8 ")],
      64,
    ),
    "lower-case riff": fixture([ascii("riff"), [0x1a, 0, 0, 0], ascii("WEBPVP8 ")], 64),
    "JPEG SOI without the third 0xFF": fixture([[0xff, 0xd8, 0x00, 0xe0]], 64),
    "JPEG SOI and 0xFF only": bytes(0xff, 0xd8, 0xff),
    "JPEG SOI then a filler 0xFF marker": fixture([[0xff, 0xd8, 0xff, 0xff, 0xff]], 64),
    "JPEG SOI then a stuffed zero": fixture([[0xff, 0xd8, 0xff, 0x00]], 64),
    "JPEG SOI then a restart marker": fixture([[0xff, 0xd8, 0xff, 0xd0]], 64),
    "JPEG SOI then a low byte": fixture([[0xff, 0xd8, 0xff, 0x80]], 64),
    "PNG signature then HTML (polyglot)": fixture(
      [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], ascii("<html><script>alert(1)</script>")],
      64,
    ),
    "PNG signature with a wrong chunk length": fixture(
      [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0e], ascii("IHDR")],
      64,
    ),
    "PNG signature with a wrong first chunk": fixture(
      [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d], ascii("IDAT")],
      64,
    ),
    "PNG with CRLF mangled by a text transfer": fixture(
      [[0x89, 0x50, 0x4e, 0x47, 0x0a, 0x1a, 0x0a], [0, 0, 0, 0x0d], ascii("IHDR")],
      64,
    ),
    "HTML followed by a PNG": fixture([ascii("<html>"), Array.from(pngFixture())], 128),
    "a JPEG preceded by one byte": fixture([[0x20], Array.from(jpegFixture())], 128),
    "a PNG preceded by one byte": fixture([[0x20], Array.from(pngFixture())], 128),
    "a WebP preceded by one byte": fixture([[0x20], Array.from(webpFixture())], 128),
    "UTF-8 byte order mark then SVG": fixture([[0xef, 0xbb, 0xbf], ascii("<svg/>")], 64),
  };

  it.each(Object.entries(refused))("%s", (_name, data) => {
    expect(sniffImageType(data)).toBeNull();
  });

  it("returns null for empty and one-byte input", () => {
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
    for (let value = 0; value < 256; value += 1) {
      expect(sniffImageType(bytes(value))).toBeNull();
    }
  });

  it("returns null for every truncation of a valid file shorter than its signature", () => {
    const signatures: [Uint8Array, number][] = [
      [jpegFixture(), 4],
      [pngFixture(), 16],
      [webpFixture(), 16],
    ];
    for (const [full, required] of signatures) {
      expect(sniffImageType(full.subarray(0, required))).not.toBeNull();
      for (let length = 0; length < required; length += 1) {
        expect(sniffImageType(full.subarray(0, length)), `length ${length}`).toBeNull();
      }
    }
  });

  it("returns null for a huge input of zeros without scanning it", () => {
    expect(sniffImageType(new Uint8Array(64 * 1024 * 1024))).toBeNull();
  });

  it("never finds a signature at a later offset (every offset from 1 to 200, all three formats)", () => {
    for (const head of [jpegFixture(), pngFixture(), webpFixture()]) {
      for (let offset = 1; offset <= 200; offset += 1) {
        const data = new Uint8Array(400);
        data.set(head.subarray(0, 32), offset);
        expect(sniffImageType(data), `offset ${offset}`).toBeNull();
      }
    }
  });

  it("does not look beyond a bounded prefix: a signature at a later offset is ignored", () => {
    const big = new Uint8Array(1_000_000);
    big.set(pngFixture().subarray(0, 32), 999_000);
    big.set(webpFixture().subarray(0, 32), 500_000);
    big.set(jpegFixture().subarray(0, 32), 17);
    expect(sniffImageType(big)).toBeNull();
  });
});

/*
 * Reference implementation, written differently from production: a regular expression over the lower-case hex of the
 * first 16 bytes (production compares bytes). The two must agree on every input the properties below generate.
 */
function referenceSniff(data: Uint8Array): "jpeg" | "png" | "webp" | null {
  const hex = toHex(data.subarray(0, 16));
  if (/^ffd8ff(c.|d[a-f]|e.|f[0-9a-e])/.test(hex)) {
    return "jpeg";
  }
  if (/^89504e470d0a1a0a0000000d49484452/.test(hex)) {
    return "png";
  }
  if (/^52494646.{8}57454250(56503820|5650384c|56503858)/.test(hex)) {
    return "webp";
  }
  return null;
}

describe("sniffImageType: seeded properties", () => {
  it("never throws and agrees with the reference on random input", () => {
    const random = seededRandom(0x5eed);
    for (let round = 0; round < 20_000; round += 1) {
      const length = Math.floor(random() * 40);
      const data = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) {
        data[index] = Math.floor(random() * 256);
      }
      expect(sniffImageType(data)).toBe(referenceSniff(data));
    }
  });

  it("agrees with the reference when random bytes follow a (possibly damaged) valid start", () => {
    const random = seededRandom(0xfeed);
    const starts = [jpegFixture(), pngFixture(), webpFixture("VP8L"), webpFixture("VP8X")];
    for (let round = 0; round < 20_000; round += 1) {
      const start = starts[Math.floor(random() * starts.length)] ?? jpegFixture();
      const data = Uint8Array.from(start);
      const damages = Math.floor(random() * 3);
      for (let damage = 0; damage < damages; damage += 1) {
        data[Math.floor(random() * 20)] = Math.floor(random() * 256);
      }
      const cut = Math.floor(random() * 40);
      expect(sniffImageType(data.subarray(0, cut))).toBe(referenceSniff(data.subarray(0, cut)));
    }
  });

  it("changing any one byte of the signature to any value matches the reference (exhaustive)", () => {
    for (const start of [jpegFixture(), pngFixture(), webpFixture()]) {
      for (let position = 0; position < 16; position += 1) {
        for (let value = 0; value < 256; value += 1) {
          const data = Uint8Array.from(start);
          data[position] = value;
          expect(sniffImageType(data), `${position}:${value}`).toBe(referenceSniff(data));
        }
      }
    }
  });

  it("never returns a type for input that lacks every signature", () => {
    const random = seededRandom(0xbad);
    for (let round = 0; round < 20_000; round += 1) {
      const data = new Uint8Array(32);
      for (let index = 0; index < data.length; index += 1) {
        data[index] = Math.floor(random() * 256);
      }
      // Force the first byte to something no format starts with: 0x00 begins none of the three.
      data[0] = 0x00;
      expect(sniffImageType(data)).toBeNull();
    }
  });
});
