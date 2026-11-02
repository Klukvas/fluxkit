/**
 * Which image URLs the storefront may hand to `next/image` (owner answer 7). The allow-list is `STOREFRONT_IMAGE_HOSTS` as
 * the running server sees it (`lib/image-hosts.server.ts`), the same variable `next.config.ts` gives the image optimizer.
 * Anything else gets the token-styled placeholder: no broken image, no request to an unknown host, no optimizer refusal.
 */

export function parseImageHosts(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host !== "");
}

/**
 * The normalized URL when it is `https`, on exactly one of `hosts`, with no credentials and no port; otherwise `null`.
 * `new URL` resolves the host, so `cdn.example.com@evil.example` and `cdn.example.com.evil.example` do not pass.
 */
export function allowedImageUrl(
  value: string | null | undefined,
  hosts: readonly string[],
  devMediaBaseUrl: string | undefined = developmentMediaBaseUrl(),
): string | null {
  if (!value) return null;
  const local = developmentMediaPath(value, devMediaBaseUrl);
  if (local !== null) return local;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") {
    return null;
  }
  return hosts.includes(url.hostname) ? url.href : null;
}

/** The key shape of an uploaded file (ADR 0028: 32 lower-case hex digits and the stored extension). */
const MEDIA_KEY = /^[0-9a-f]{32}\.(jpg|png|webp)$/;

/**
 * DEVELOPMENT ONLY (owner decision 2026-11-01, plan docs/plans/2026-11-01-demo-images-local-run.md, option a). The API's
 * media prefix that `next.config.ts` hands to `next dev` (and only to it) as `FLUXKIT_DEV_MEDIA_BASE_URL`. `undefined`
 * unless `NODE_ENV` is `development`: `next build` inlines `production` there, so in a production bundle this is dead
 * code and only the https allow-list applies (ADR 0028, owner answer 7).
 */
export function developmentMediaBaseUrl(): string | undefined {
  if (process.env.NODE_ENV !== "development") return undefined;
  const value = process.env.FLUXKIT_DEV_MEDIA_BASE_URL;
  return value === undefined || value === "" ? undefined : value;
}

/**
 * `<base>/<media key>` becomes the same-origin `/media/<key>`, which `next dev` rewrites to the API, so `next/image` loads
 * it from its own origin (the optimizer never fetches a loopback address). Anything else: `null`.
 */
function developmentMediaPath(value: string, base: string | undefined): string | null {
  if (base === undefined || !value.startsWith(`${base}/`)) return null;
  const key = value.slice(base.length + 1);
  return MEDIA_KEY.test(key) ? `/media/${key}` : null;
}
