import type { HeaderConfig } from "../layout/header-layout";

/**
 * A FILLED header config as a client fork would write it (`config/header.ts`), for `vitest.brand-fork.config.ts` only: that
 * run replaces the real file with this one (and `config/footer.ts` with `footer-fork-fixture.ts`, a module of its own as in a
 * fork, so a spec that mocks one of them keeps the other) and runs the unit suite again, so a spec that silently depends on the
 * template's default order, category count or links fails upstream instead of in a fork (plan L3: a fork changes the header by
 * editing only this file). `components/header-footer-defaults.upstream.spec.tsx`, which pins the default markup, is left out
 * of that run.
 */
export const headerConfig: HeaderConfig = {
  blocks: ["menu", "search", "logo", "navigation", "controls"],
  controls: ["cart", "account", "language"],
  navigation: {
    categoryLimit: 4,
    links: [
      { labelKey: "nav.catalog", href: "/catalog" },
      { labelKey: "shopPages.delivery.title", href: "/delivery-and-payment" },
    ],
  },
};
