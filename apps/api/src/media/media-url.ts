import { isMediaKey, type MediaKey } from "@fluxkit/core";

/**
 * What a stored media URL (`media.url`, `brand.logo_url`) means for attach marking (ADR 0028 decision 5):
 * - `foreign`: not under `MEDIA_PUBLIC_BASE_URL`; URL-based media, left alone;
 * - `upload`: under the prefix and naming a key, which must have a `media_upload` row;
 * - `invalid`: under the prefix but naming no key (a query, a fragment, credentials, a wrong shape); refused like an
 *   unknown upload, because nothing of ours can ever be served at it.
 */
export type MediaUrlReference =
  { kind: "foreign" } | { kind: "upload"; key: MediaKey } | { kind: "invalid" };

/**
 * Compares by the parsed origin (scheme, host case and default port normalized by the URL parser) and by the path prefix
 * without regard to case, because the HTTP router matches `/MEDIA/...` like `/media/...`. The part after the prefix is
 * taken RAW (still percent-encoded), so an encoded or decorated key never counts as a key.
 */
export function classifyMediaUrl(url: string, publicBaseUrl: string): MediaUrlReference {
  // Throws a TypeError for a base that is not an absolute URL: a misconfiguration must not match everything.
  const base = new URL(publicBaseUrl);
  if (!URL.canParse(url)) {
    return { kind: "foreign" };
  }
  const parsed = new URL(url);
  if (parsed.origin !== base.origin) {
    return { kind: "foreign" };
  }
  const prefix = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  if (!parsed.pathname.toLowerCase().startsWith(prefix.toLowerCase())) {
    return { kind: "foreign" };
  }
  const rest = parsed.pathname.slice(prefix.length);
  if (
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    !isMediaKey(rest)
  ) {
    return { kind: "invalid" };
  }
  return { kind: "upload", key: rest };
}
