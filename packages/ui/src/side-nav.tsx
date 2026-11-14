import { useId, type ReactNode } from "react";
import { SideNavTooltip } from "./side-nav-tooltip";
import { cn } from "./cn";
import { focusRing, textStyles } from "./styles";

export interface SideNavItem {
  id: string;
  label: string;
  href: string;
  current?: boolean;
  icon?: ReactNode;
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
  collapsed?: boolean;
  currentTone?: "solid" | "muted";
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
  collapsed = false,
  currentTone = "solid",
}: SideNavProps) {
  const instanceId = useId();
  return (
    <nav aria-label={label} className="flex flex-col gap-6">
      {groups.map((group) => {
        const headingId = `${instanceId}-side-nav-${group.id}`;
        return (
          <div key={group.id}>
            {group.heading ? (
              <Heading
                id={headingId}
                className={cn(textStyles.navGroupTitle, collapsed ? "sr-only" : "px-3 pb-1")}
              >
                {group.heading}
              </Heading>
            ) : null}
            {collapsed && group.heading ? (
              <div aria-hidden="true" className="mb-2 border-t border-border" />
            ) : null}
            <ul
              aria-labelledby={group.heading ? headingId : undefined}
              className="flex flex-col gap-1"
            >
              {group.items.map((item) => (
                <li key={item.id}>{renderItem(item, renderLink, collapsed, currentTone)}</li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function renderItem(
  item: SideNavItem,
  renderLink: NonNullable<SideNavProps["renderLink"]>,
  collapsed: boolean,
  currentTone: "solid" | "muted",
): ReactNode {
  const link = renderLink({
    href: item.href,
    ...(item.current ? { "aria-current": "page" as const } : {}),
    className: cn(
      "flex min-h-11 items-center gap-3 rounded-control px-3 py-2 font-medium",
      collapsed && item.icon ? "justify-center" : undefined,
      focusRing,
      item.current
        ? currentTone === "muted"
          ? "bg-muted text-foreground"
          : "bg-primary text-primary-foreground"
        : "text-foreground hover:bg-muted",
    ),
    children: item.icon ? (
      <>
        {item.icon}
        <span className={collapsed ? "sr-only" : undefined}>{item.label}</span>
      </>
    ) : (
      item.label
    ),
  });
  return collapsed && item.icon ? <SideNavTooltip label={item.label}>{link}</SideNavTooltip> : link;
}
