import type { FooterConfig } from "../layout/footer-layout";
import type { HeaderConfig } from "../layout/header-layout";

/**
 * FILLED header and footer configs as a client fork would write them (`config/header.ts`, `config/footer.ts`), for
 * `vitest.brand-fork.config.ts` only: that run replaces both files with this one and runs the unit suite again, so a spec that
 * silently depends on the template's default order, category count or link groups fails upstream instead of in a fork (plan
 * L3: a fork changes the header and footer by editing only those two files). `components/header-footer-defaults.spec.tsx`,
 * which pins the default markup, is left out of that run.
 */
export const headerConfig: HeaderConfig = {
  blocks: ["logo", "menu", "navigation", "search", "controls"],
  controls: ["cart", "account", "language"],
  navigation: {
    categoryLimit: 4,
    links: [
      { labelKey: "nav.catalog", href: "/catalog" },
      { labelKey: "shopPages.delivery.title", href: "/delivery-and-payment" },
    ],
  },
};

export const footerConfig: FooterConfig = {
  blocks: ["copyright", "navigation", "themeSwitch", "contacts"],
  navigation: {
    groups: [
      { kind: "legal" },
      { kind: "shopPages" },
      { kind: "links", links: [{ labelKey: "nav.catalog", href: "/catalog" }] },
    ],
  },
};
