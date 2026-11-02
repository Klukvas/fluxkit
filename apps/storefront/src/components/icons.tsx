import type { SVGProps } from "react";

/**
 * Decorative line icons of the header (24 x 24, stroke `currentColor`, so they take the text colour token). Always hidden from
 * assistive technology: the control around an icon carries the translated name. Replace them here to restyle the shop.
 */
function Icon({ children, className = "", ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      // Stroke and fill come from `.fk-icon` (app/globals.css): fewer bytes in every page's header.
      aria-hidden="true"
      focusable="false"
      {...props}
      className={className === "" ? "fk-icon" : `fk-icon ${className}`}
    >
      {children}
    </svg>
  );
}

export function CartIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="18" cy="20" r="1.5" />
      <path d="M2 3h3l2.6 12.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.5L21.5 8H6.2" />
    </Icon>
  );
}

export function UserIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </Icon>
  );
}

export function MenuIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Icon>
  );
}

export function ChevronDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon width="16" height="16" {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}
