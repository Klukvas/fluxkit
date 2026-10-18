/**
 * robots.txt content (plan, SEO). The shopper-specific pages are `noindex` in their own metadata (steps 6 and 7) and are
 * also kept out of crawls here; `/store/` is the API, not a page. Pure: the route passes the public origin.
 */

/** Paths after the locale of the pages that belong to one shopper. */
export const PRIVATE_PATHS = ["/cart", "/checkout", "/account", "/order"] as const;

export interface RobotsFile {
  rules: { userAgent: string; allow: string; disallow: string[] }[];
  sitemap: string;
}

export function buildRobots(input: { origin: string; locales: readonly string[] }): RobotsFile {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          ...input.locales.flatMap((locale) => PRIVATE_PATHS.map((path) => `/${locale}${path}`)),
          "/store/",
        ],
      },
    ],
    sitemap: `${input.origin}/sitemap.xml`,
  };
}
