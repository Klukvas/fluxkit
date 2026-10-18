import { parseImageHosts } from "./image-source";

/**
 * The hosts `next/image` may load from, as the app was BUILT (`next.config.ts` inlines `STOREFRONT_IMAGE_HOSTS` here at
 * `next build`). Reading the live environment instead could disagree with the optimizer's own allow-list and give a broken
 * image. The reference must stay `process.env.STOREFRONT_IMAGE_HOSTS_AT_BUILD` written out: Next replaces exactly that text.
 */
export const IMAGE_HOSTS: readonly string[] = parseImageHosts(
  process.env.STOREFRONT_IMAGE_HOSTS_AT_BUILD,
);
