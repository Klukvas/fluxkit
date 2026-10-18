import type { ProductMedia } from "@fluxkit/api-client";
import { allowedImageUrl } from "./image-source";

/** One gallery entry. `src` is `null` when the image must be the placeholder (missing, or a host that is not allowed). */
export interface GalleryItem {
  src: string | null;
  alt: string | null;
  optionValueId: string | null;
}

/** Server side: checks every media URL against the host allow-list once, so the client never sees a disallowed URL. */
export function prepareMedia(
  media: readonly ProductMedia[],
  hosts: readonly string[],
): GalleryItem[] {
  return media.map((item) => ({
    src: allowedImageUrl(item.url, hosts),
    alt: item.alt,
    optionValueId: item.optionValueId,
  }));
}

/**
 * Media for the selected option values first (so choosing "red" shows the red photos), then media that belongs to no
 * value, then the rest, each group in the API's order. A product without media gets one placeholder entry.
 */
export function galleryFor(
  items: readonly GalleryItem[],
  selectedValueIds: readonly string[],
): GalleryItem[] {
  if (items.length === 0) return [{ src: null, alt: null, optionValueId: null }];
  const selected = items.filter(
    (item) => item.optionValueId !== null && selectedValueIds.includes(item.optionValueId),
  );
  const general = items.filter((item) => item.optionValueId === null);
  const rest = items.filter((item) => !selected.includes(item) && !general.includes(item));
  return [...selected, ...general, ...rest];
}
