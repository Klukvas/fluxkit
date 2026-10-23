/*
 * Test-only helpers of the media specs (excluded from the build by tsconfig.build.json). The fixtures are BYTES built here, not
 * files: the first bytes of a real container, then filler. Nothing in them is a complete decodable image; the sniffer only
 * ever looks at the start, and that is what is under test.
 */

export function bytes(...values: readonly number[]): Uint8Array {
  return Uint8Array.from(values);
}

export function ascii(text: string): number[] {
  return [...text].map((character) => character.charCodeAt(0));
}

/** Concatenates parts and pads with `fill` up to `length` bytes (never shortens). */
export function fixture(parts: readonly (readonly number[])[], length = 0, fill = 0): Uint8Array {
  const joined = parts.flat();
  while (joined.length < length) {
    joined.push(fill);
  }
  return Uint8Array.from(joined);
}

export function toHex(data: Uint8Array): string {
  return [...data].map((value) => value.toString(16).padStart(2, "0")).join("");
}

/** JPEG: SOI, then a JFIF APP0 segment. */
export function jpegFixture(marker = 0xe0): Uint8Array {
  return fixture(
    [[0xff, 0xd8, 0xff, marker, 0x00, 0x10], ascii("JFIF"), [0x00, 0x01, 0x01, 0x00]],
    64,
  );
}

/** PNG: the 8-byte signature, then an IHDR chunk header (length 13). */
export function pngFixture(): Uint8Array {
  return fixture(
    [
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      [0x00, 0x00, 0x00, 0x0d],
      ascii("IHDR"),
      [0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00],
    ],
    64,
  );
}

/** WebP: RIFF, a size, `WEBP`, then the first chunk (`VP8 `, `VP8L` or `VP8X`). */
export function webpFixture(chunk = "VP8 "): Uint8Array {
  return fixture([ascii("RIFF"), [0x1a, 0x00, 0x00, 0x00], ascii("WEBP"), ascii(chunk)], 64);
}

/** Small deterministic generator (mulberry32) so a failing property case reproduces. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
