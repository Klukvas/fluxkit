import type { ReactNode } from "react";
import { cn } from "./cn";
import { focusRing } from "./styles";

export interface SideNavItem {
  id: string;
  label: string;
  href: string;
  current?: boolean;
}

export interface SideNavGroup {
  id: string;
  /** Visible group heading; a group without one is a plain list. */
  heading?: string;
  items: SideNavItem[];
}

export interface SideNavLinkProps {
  href: string;
  className: string;
  "aria-current"?: "page";
  children: ReactNode;
}

export interface SideNavProps {
  /** Accessible name of the nav landmark. */
  label: string;
  groups: SideNavGroup[];
  headingAs?: "h2" | "h3";
  /** Renders one link, so the app can use its router's link; spread the props on it. Defaults to a plain `<a>`. */
  renderLink?: (link: SideNavLinkProps) => ReactNode;
}

const defaultLink = ({ children, ...link }: SideNavLinkProps): ReactNode => (
  <a {...link}>{children}</a>
);

export function SideNav({
  label,
  groups,
  headingAs: Heading = "h2",
  renderLink = defaultLink,
}: SideNavProps) {
  return (
    <nav aria-label={label} className="flex flex-col gap-6">
      {groups.map((group) => {
        const headingId = `side-nav-${group.id}`;
        return (
          <div key={group.id}>
            {group.heading ? (
              <Heading
                id={headingId}
                className="px-3 pb-1 text-sm font-semibold text-muted-foreground"
              >
                {group.heading}
              </Heading>
            ) : null}
            <ul
              aria-labelledby={group.heading ? headingId : undefined}
              className="flex flex-col gap-1"
            >
              {group.items.map((item) => (
                <li key={item.id}>
                  {renderLink({
                    href: item.href,
                    ...(item.current ? { "aria-current": "page" as const } : {}),
                    className: cn(
                      "flex min-h-11 items-center rounded-md px-3 py-2 font-medium",
                      focusRing,
                      item.current
                        ? "bg-primary text-primary-foreground"
                        : "text-foreground hover:bg-muted",
                    ),
                    children: item.label,
                  })}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
