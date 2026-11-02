import { accountLinks } from "../layout/navigation";
import { isOrderNumber } from "./order-links";

/** One breadcrumb of an account page: a message key or a literal label (an order number), and a locale-less link. */
export interface AccountCrumb {
  labelKey?: string;
  label?: string;
  /** Absent on the current page (the last crumb). */
  href?: string;
}

const HOME = "/";
const OVERVIEW = "/account";

/**
 * The breadcrumbs of a signed-in account page (review recommendation 3): Home / My account / section / order number, from the
 * locale-less path. Sections are the account menu's links (`accountLinks`); a path that is not an account page answers `[]`.
 * An order number appears only when it has the shape of one (`isOrderNumber`); anything else in the path is not shown.
 */
export function accountTrail(pathname: string): AccountCrumb[] {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const overview = accountLinks.find((link) => link.href === OVERVIEW);
  if (overview === undefined) return [];
  if (path === OVERVIEW) {
    return [{ labelKey: "breadcrumbs.home", href: HOME }, { labelKey: overview.labelKey }];
  }
  const section = accountLinks.find(
    (link) => link.href !== OVERVIEW && (path === link.href || path.startsWith(`${link.href}/`)),
  );
  if (section === undefined) return [];
  const trail: AccountCrumb[] = [
    { labelKey: "breadcrumbs.home", href: HOME },
    { labelKey: overview.labelKey, href: OVERVIEW },
  ];
  if (path === section.href) return [...trail, { labelKey: section.labelKey }];
  const rest = path.slice(section.href.length + 1);
  let number: string;
  try {
    number = decodeURIComponent(rest);
  } catch {
    // A malformed escape in the address: the section is still right, the rest is not shown.
    return [...trail, { labelKey: section.labelKey }];
  }
  return isOrderNumber(number)
    ? [...trail, { labelKey: section.labelKey, href: section.href }, { label: number }]
    : [...trail, { labelKey: section.labelKey }];
}
