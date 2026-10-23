import { ALLOWED_IMAGE_TYPES, contentTypeOf, extensionOf } from "./image-types.js";
import type { AllowedImageType } from "./image-types.js";

export { contentTypeOf, extensionOf };

/*
 * The storage key of an uploaded image (ADR 0028 decision 6): 128 random bits as 32 lower-case hex digits, a dot and the
 * extension of the OUTPUT type. No client input reaches it. The same strict pattern guards the read route, the storage
 * driver and the database CHECK, so nothing but a key we generated is ever turned into a path or a lookup.
 */

/** Random bytes in a key. */
export const MEDIA_KEY_BYTES = 16;

/** Branded so a plain string cannot be passed where a validated key is required. */
export type MediaKey = string & { readonly __brand: "MediaKey" };

// Explicit ranges, not \d or \w: those do not match non-ASCII digits in JavaScript, but a literal class cannot drift.
const MEDIA_KEY_PATTERN = /^[0-9a-f]{32}\.(?:jpg|png|webp)$/;

export function isMediaKey(value: unknown): value is MediaKey {
  return typeof value === "string" && MEDIA_KEY_PATTERN.test(value);
}

function assertMediaKey(value: string): asserts value is MediaKey {
  if (!isMediaKey(value)) {
    throw new RangeError("Not a media key");
  }
}

/** `ab/cd/<key>`: two directory levels of the first four hex digits keep directories small. Throws for a non-key. */
export function keyToRelativePath(key: string): string {
  assertMediaKey(key);
  return `${key.slice(0, 2)}/${key.slice(2, 4)}/${key}`;
}

/** The image type a key's extension names (the server chose the extension from the sniffed type). */
export function typeOfKey(key: string): AllowedImageType {
  assertMediaKey(key);
  const extension = key.slice(key.lastIndexOf(".") + 1);
  const type = (Object.keys(ALLOWED_IMAGE_TYPES) as AllowedImageType[]).find(
    (candidate) => extensionOf(candidate) === extension,
  );
  if (type === undefined) {
    throw new RangeError("Not a media key");
  }
  return type;
}

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const value of bytes) {
    hex += value.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Builds a new key. Core is pure and imports no `node:crypto`, so the caller supplies the randomness
 * (`randomBytes` from `node:crypto` in the API). A source that returns anything but exactly 16 bytes is refused rather than
 * padded or cut: a short key would silently weaken the unguessable URL. A source that throws is not caught.
 */
export function generateMediaKey(
  randomBytes: (size: number) => Uint8Array,
  type: AllowedImageType,
): MediaKey {
  const extension = extensionOf(type);
  const bytes = randomBytes(MEDIA_KEY_BYTES);
  if (!(bytes instanceof Uint8Array) || bytes.length !== MEDIA_KEY_BYTES) {
    throw new RangeError(`The random source must return exactly ${MEDIA_KEY_BYTES} bytes`);
  }
  const key = `${toHex(bytes)}.${extension}`;
  assertMediaKey(key);
  return key;
}
