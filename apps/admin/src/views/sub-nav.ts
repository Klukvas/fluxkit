// At least 24 px high (WCAG 2.5.8), 44 px on a touch screen: the sizing of `Breadcrumbs` in `@fluxkit/ui`.
const subNavLinkBase =
  "inline-flex min-h-6 items-center underline underline-offset-4 pointer-coarse:min-h-11";

/** The link class of an area's sub-navigation (dictionaries, shipping, e-mail, search, personal data): the current item bold. */
export function subNavLinkClass(isCurrent: boolean): string {
  return isCurrent
    ? `${subNavLinkBase} font-semibold text-foreground`
    : `${subNavLinkBase} text-muted-foreground`;
}
