import type { Translator } from "@fluxkit/ui";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { PATHS, type RouteId } from "../../router/paths";
import { PageHeader } from "../../views/status-views";
import { subNavLinkClass } from "../../views/sub-nav";

/** The two lists of the Shipping area, in the order of the sub-navigation (both need shipping.manage). */
export const SHIPPING_SCREENS = [
  { id: "shipping", titleKey: "page.shipping.title" },
  { id: "shippingProviders", titleKey: "page.shippingProviders.title" },
] as const satisfies readonly { id: RouteId; titleKey: string }[];

export type ShippingScreenId = (typeof SHIPPING_SCREENS)[number]["id"];

/** Sub-navigation of the area: delivery methods and carriers, the current one marked with `aria-current`. */
export function ShippingNav({ t, current }: { t: Translator; current: ShippingScreenId }) {
  return (
    <nav aria-label={t("ship.nav.label")}>
      <ul className="flex flex-wrap gap-x-5 gap-y-2">
        {SHIPPING_SCREENS.map((screen) => (
          <li key={screen.id}>
            <Link
              to={PATHS[screen.id]}
              aria-current={screen.id === current ? "page" : undefined}
              className={subNavLinkClass(screen.id === current)}
            >
              {t(screen.titleKey)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Every screen of the area: the sub-navigation, then the one `h1`, then the content. */
export function ShippingFrame({
  t,
  current,
  title,
  description,
  actions,
  children,
}: {
  t: Translator;
  current: ShippingScreenId;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <ShippingNav t={t} current={current} />
      <PageHeader title={title} description={description} actions={actions} />
      {children}
    </div>
  );
}
