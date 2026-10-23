/*
 * The image types an upload may have (ADR 0028 decision 3): JPEG, PNG and WebP, static only. This table is the single place
 * that ties a type to its file extension and content type, so the key, the stored row and the read route cannot disagree.
 */

export type AllowedImageType = "jpeg" | "png" | "webp";
export type AllowedContentType = "image/jpeg" | "image/png" | "image/webp";

interface ImageTypeFacts {
  readonly extension: "jpg" | "png" | "webp";
  readonly contentType: AllowedContentType;
}

export const ALLOWED_IMAGE_TYPES: Readonly<Record<AllowedImageType, Readonly<ImageTypeFacts>>> =
  Object.freeze({
    jpeg: Object.freeze({ extension: "jpg", contentType: "image/jpeg" }),
    png: Object.freeze({ extension: "png", contentType: "image/png" }),
    webp: Object.freeze({ extension: "webp", contentType: "image/webp" }),
  } as const);

/** Own-property lookup, so a hostile name such as `constructor` or `__proto__` is refused instead of resolved. */
function factsOf(type: AllowedImageType): Readonly<ImageTypeFacts> {
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_IMAGE_TYPES, type)) {
    throw new RangeError(`Not an allowed image type: ${String(type)}`);
  }
  return ALLOWED_IMAGE_TYPES[type];
}

/** The extension of the stored file for an OUTPUT type (`jpeg` -> `jpg`). */
export function extensionOf(type: AllowedImageType): ImageTypeFacts["extension"] {
  return factsOf(type).extension;
}

/** The `Content-Type` the read route sends for a type; never taken from the client. */
export function contentTypeOf(type: AllowedImageType): AllowedContentType {
  return factsOf(type).contentType;
}
