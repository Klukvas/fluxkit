import type { ReactElement, ReactNode, SVGProps } from "react";
import { cn } from "./cn";

/** Replace this decorative line-icon family in one file when rebranding a client fork. */
export type IconProps = Pick<SVGProps<SVGSVGElement>, "className">;

function Icon({ className, children }: IconProps & { children: ReactNode }): ReactElement {
  return (
    <svg
      className={cn("size-6 shrink-0", className)}
      viewBox="0 0 24 24"
      stroke="currentColor"
      fill="none"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function HomeIcon(props: IconProps): ReactElement {
  return (
    <Icon {...props}>
      <path d="M3 10 12 3l9 7v11h-6v-7H9v7H3Z" />
    </Icon>
  );
}

export function OrdersIcon(props: IconProps): ReactElement {
  return (
    <Icon {...props}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2ZM9 7h6M9 11h6" />
    </Icon>
  );
}

export function ProductsIcon(props: IconProps): ReactElement {
  return (
    <Icon {...props}>
      <path d="m3 7 9-4 9 4v10l-9 4-9-4Zm0 0 9 4 9-4M12 11v10M7 5l10 4" />
    </Icon>
  );
}

export function CustomersIcon(props: IconProps): ReactElement {
  return (
    <Icon {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M17 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-4" />
      <circle cx="9" cy="7" r="4" />
    </Icon>
  );
}

export function PaymentsIcon(props: IconProps): ReactElement {
  return (
    <Icon {...props}>
      <path d="M3 5h18v14H3ZM3 9h18M7 15h3" />
    </Icon>
  );
}

export function CategoriesIcon(props: IconProps): ReactElement {
  return (
    <Icon {...props}>
      <path d="M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z" />
    </Icon>
  );
}

export function BrandsIcon(props: IconProps): ReactElement {
  return (
    <Icon {...props}>
      <path d="M3 3h8l10 10-8 8L3 11ZM7 7h.01" />
    </Icon>
  );
}

export function ProductTypesIcon(props: IconProps): ReactElement {
  return (
    <Icon {...props}>
      <path d="M4 4h16v16H4ZM4 10h16M10 10v10" />
    </Icon>
  );
}

export function AttributesIcon(props: IconProps): ReactElement {
  return (
    <Icon {...props}>
      <path d="M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6" />
    </Icon>
  );
}

export function OptionsIcon(props: IconProps): ReactElement {
  return (
    <Icon {...props}>
      <path d="M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1" />
    </Icon>
  );
}

export function BannersIcon(props: IconProps): ReactElement {
  return (
    <Icon {...props}>
      <path d="M3 4h18v16H3ZM3 16l5-5 4 4 3-3 6 6M7 8h.01" />
    </Icon>
  );
}

export function SearchIcon(props: IconProps): ReactElement {
  return (
    <Icon {...props}>
      <path d="M21 21l-5-5" />
      <circle cx="10" cy="10" r="7" />
    </Icon>
  );
}

export function ShippingIcon(props: IconProps): ReactElement {
  return (
    <Icon {...props}>
      <path d="M1 5h13v12H1ZM14 9h5l4 4v4h-3M5 17h10" />
      <circle cx="5" cy="18" r="3" />
      <circle cx="18" cy="18" r="3" />
    </Icon>
  );
}

export function EmailIcon(props: IconProps): ReactElement {
  return (
    <Icon {...props}>
      <path d="M3 5h18v14H3ZM3 5l9 7 9-7" />
    </Icon>
  );
}

export function PersonalDataIcon(props: IconProps): ReactElement {
  return (
    <Icon {...props}>
      <path d="M12 3 3 7v6c0 4 9 8 9 8s9-4 9-8V7ZM9 12l2 2 4-4" />
    </Icon>
  );
}

export function AuditLogIcon(props: IconProps): ReactElement {
  return (
    <Icon {...props}>
      <path d="M5 3h14v18H5ZM9 7h6M9 12h6M9 17h4" />
    </Icon>
  );
}

export function AdministratorsIcon(props: IconProps): ReactElement {
  return (
    <Icon {...props}>
      <path d="M4 21a8 8 0 0 1 16 0" />
      <circle cx="12" cy="7" r="4" />
    </Icon>
  );
}

export function HelpIcon(props: IconProps): ReactElement {
  return (
    <Icon {...props}>
      <path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5M12 17h.01" />
      <circle cx="12" cy="12" r="10" />
    </Icon>
  );
}

export function SidebarCollapseIcon(props: IconProps): ReactElement {
  return (
    <Icon className={cn("rtl:-scale-x-100", props.className)}>
      <path d="M3 3h18v18H3ZM9 3v18m8-13-4 4 4 4" />
    </Icon>
  );
}

export function SidebarExpandIcon(props: IconProps): ReactElement {
  return (
    <Icon className={cn("rtl:-scale-x-100", props.className)}>
      <path d="M3 3h18v18H3ZM9 3v18m4-13 4 4-4 4" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps): ReactElement {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function ChevronIcon(props: IconProps): ReactElement {
  return (
    <Icon {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

/** A shared fallback for optional feature entries without a manifest icon. */
export function ExtensionIcon(props: IconProps): ReactElement {
  return (
    <Icon {...props}>
      <path d="M9 3v4H5v4H3v4h2v6h6v-2h4v2h6v-6h-4v-4h4V7h-6V3Z" />
    </Icon>
  );
}
