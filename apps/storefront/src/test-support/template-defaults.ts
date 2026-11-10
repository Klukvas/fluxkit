import type { CardRegistry } from "../components/cards/types";
import type { FooterConfig } from "../layout/footer-layout";
import type { HeaderConfig } from "../layout/header-layout";
import type { SlotRegistry } from "../lib/slots";

/**
 * The TEMPLATE'S DEFAULTS of the fork-owned files that shape the storefront's own markup, for specs only (A1 acceptance runs,
 * PR-I2b). A spec that pins the template's built-in output (the default cards, the frame, the footer blocks) must keep passing
 * in a fork that changed those files the way `docs/customization.md` describes, without a test edit. Such a spec mocks the
 * fork-owned module with this one, whose exports carry the same names:
 *
 *   vi.mock("./cards/custom", () => import("../test-support/template-defaults"));
 *   vi.mock("../config/footer", () => import("../test-support/template-defaults"));
 *
 * (The factory imports this module itself: a `vi.mock` call is hoisted above the spec's imports, so it cannot use an import.)
 * Upstream-owned; the copies here equal the files upstream ships, which upstream never edits after creating them. Each copy is
 * compared with its real file by an UPSTREAM-ONLY spec (a fork deletes it once it changes that file, `docs/customization.md`
 * step 0): `headerConfig` and `footerConfig` by `components/header-footer-defaults.upstream.spec.tsx`, `slots` by
 * `config/slots.upstream.spec.ts`, `customCards` by `components/cards/custom.upstream.spec.ts`. Both fork runs
 * (`vitest.brand-fork.config.ts`, `vitest.home-fork.config.ts`) run the specs with filled copies of some of these files, so a
 * spec that pins template output without this mock fails upstream instead of in a fork.
 */

/** `config/header.ts` as the template ships it. */
export const headerConfig: HeaderConfig = {
  blocks: ["menu", "logo", "navigation", "search", "controls"],
  controls: ["language", "cart", "account"],
  navigation: {
    categoryLimit: 6,
    links: [{ labelKey: "nav.catalog", href: "/catalog" }],
  },
};

/** `config/footer.ts` as the template ships it. */
export const footerConfig: FooterConfig = {
  blocks: ["navigation", "contacts", "themeSwitch", "copyright"],
  navigation: {
    groups: [{ kind: "shopPages" }, { kind: "legal" }],
  },
};

/** `components/cards/custom.ts` as the template ships it: no card of a fork's own, the built-in `grid` and `list` render. */
export const customCards: CardRegistry = {};

/** `config/slots.tsx` as the template ships it: every slot empty. */
export const slots: SlotRegistry = {};
