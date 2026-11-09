/**
 * Class strings the storefront shares between its own components. Tokens only (the design guard checks this folder).
 * `focusRing` repeats the one in `@fluxkit/ui` (not exported there); `linkButton` is the link twin of `Button` (a
 * navigation is an `<a>`, not a `<button>`).
 */
export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export const linkButton = `inline-flex min-h-11 items-center justify-center rounded-control bg-primary px-4 py-2 font-medium text-primary-foreground ${focusRing}`;
