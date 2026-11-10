import { AnnouncementBar } from "../components/fork/announcement-bar";
import type { SlotRegistry } from "../lib/slots";

/**
 * FORK-OWNED (plan 2026-11-08-design-changeability.md, S1 and principle 6; contract `docs/contracts/slots.md`; how-to
 * `docs/customization.md`): the components of the storefront's four UI slots. Upstream ships it empty and never edits it
 * afterwards, so a fork's entries never conflict with template updates. Empty, every slot renders nothing at all (no element,
 * no byte).
 *
 * The slots and where they render:
 * - `header.top`: inside the header, above its row (an announcement bar). Below `lg` the header is sticky, and so is this.
 * - `product-card.badges`: on the built-in `grid` and `list` cards, a row above the brand and title (badges such as "new").
 * - `product-card.actions`: on the same cards, above the card's link layer (in the image's bottom right corner on `grid`, at
 *   the end of the price row on `list`); each action is a control of its own with an opaque background (no text directly on a
 *   photo), an accessible name and a 44 px target.
 * - `footer.columns`: at the top of the footer, each component one column of a grid (side by side from `sm`, up to four per row
 *   from `lg`). For a four-column footer, move `navigation` and `contacts` out of `blocks` in `config/footer.ts` and render
 *   them in columns from the props (`shopLinks`, `legalLinks`, `contacts`). The footer's own CSS styles column content too:
 *   `flex-col` on a column's list, `whitespace-normal` on its links.
 *
 * Each entry is a SERVER component in a NEW file of the fork (never a `'use client'` file: `client-boundary.spec.ts`; a client
 * reference throws on render). It receives the slot's plain view model (`lib/slots.ts`): locale, translator and the slot's data.
 * Its texts go through `t` with keys of the fork's `custom.` namespace (`src/messages-extra/{uk,en}.json`); token classes only.
 * An interactive part is a client component the server component renders with plain, already translated props. A component
 * that throws takes the page down (no error boundary): handle a failed read inside it.
 *
 * Example (an announcement bar in the fork's new file `components/announcement-bar.tsx`):
 *
 *   import { AnnouncementBar } from "../components/announcement-bar";
 *   export const slots: SlotRegistry = { "header.top": [AnnouncementBar] };
 */
export const slots: SlotRegistry = {
  // Reshape R3: the thin announcement bar (`config/announcement.ts`).
  "header.top": [AnnouncementBar],
};
