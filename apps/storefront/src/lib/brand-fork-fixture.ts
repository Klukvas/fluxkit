import type { BrandConfig } from "./brand";

/**
 * A FILLED brand config as a client fork would write it (`config/brand.ts`), for `vitest.brand-fork.config.ts` only: that run
 * replaces `config/brand.ts` with this file and runs the unit suite again, so a spec that silently depends on the template's
 * defaults (text logo, no `og:image`) fails upstream instead of in a fork (plan B1/B3: a rebrand needs no test edit). The
 * paths do not exist under `public/`; `config/brand.spec.ts`, which checks the real file's paths, is left out of that run.
 */
export const forkBrand: BrandConfig = {
  logo: {
    kind: "image",
    light: { src: "/brand/logo.svg", width: 120, height: 32 },
    dark: { src: "/brand/logo-dark.svg", width: 120, height: 32 },
  },
  icons: [{ src: "/brand/icon.svg", type: "image/svg+xml", sizes: "any" }],
  appleIcon: { src: "/brand/apple-icon.png" },
  themeColor: true,
  ogImage: { src: "/brand/og.png", width: 1200, height: 630 },
};

export { forkBrand as brand };
