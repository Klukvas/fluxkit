/**
 * Class strings the storefront shares between its own components. Tokens only (the design guard checks this folder).
 * `focusRing` repeats the one in `@fluxkit/ui` (not exported there); `linkButton` is the link twin of `Button` (a
 * navigation is an `<a>`, not a `<button>`).
 */
export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export const linkButton = `inline-flex min-h-11 items-center justify-center rounded-control bg-primary px-4 py-2 font-medium text-primary-foreground ${focusRing}`;

/**
 * A product card's purchase link (the "choose options" link, the add button's link before hydration): the twin of the
 * card's secondary button, the same size and look, so every card's action lines up in a grid. 44 px high everywhere.
 */
export const cardActionLink = `inline-flex min-h-11 w-full items-center justify-center rounded-control border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted ${focusRing}`;
