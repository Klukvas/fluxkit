import { parseImageHosts } from "./image-source";

/**
 * The hosts `next/image` may load from, read from the live environment on every call. Server code only.
 *
 * Why the environment and not a build-time copy (verified on Next 16.4.1, README "Images"): `next start` evaluates
 * `next.config.ts` again, so the optimizer's `images.remotePatterns` come from the variable AS THE SERVER STARTS, while the
 * CSP headers keep the value from `next build`. A page that used the build value could offer an image the optimizer then
 * refuses (a broken image) or hide one it would serve. Reading the same variable here makes the page and the optimizer
 * agree whatever the build saw. The CSP list is not involved: optimized images load from `/_next/image` (`'self'`).
 */
export function imageHosts(): readonly string[] {
  return parseImageHosts(process.env.STOREFRONT_IMAGE_HOSTS);
}
