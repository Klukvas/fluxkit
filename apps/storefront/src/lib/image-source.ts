/**
 * Which image URLs the storefront may hand to `next/image` (owner answer 7). The allow-list is the host list that Next
 * itself was BUILT with (`next.config.ts` puts `STOREFRONT_IMAGE_HOSTS` into `images.remotePatterns` and into this app's
 * bundle as `STOREFRONT_IMAGE_HOSTS_AT_BUILD`), so this check and the optimizer can never disagree. Anything else gets the
 * token-styled placeholder: no broken image, no request to an unknown host, no optimizer error at run time.
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
): string | null {
  if (!value) return null;
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
