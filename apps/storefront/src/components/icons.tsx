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
      // Fill, stroke colour, width, caps and joins come from `.fk-icon` (app/globals.css): fewer bytes in every page's header.
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

export function SearchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </Icon>
  );
}

export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
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

/** Trust bar icons (`config/trust-bar.ts`): a delivery van, a lock, a chat bubble, a return arrow; 20 px beside a line of text. */
export function DeliveryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon width="20" height="20" {...props}>
      <path d="M3 6h11v10H3zM14 9h4l3 3v4h-7" />
      <circle cx="7" cy="18" r="1.5" />
      <circle cx="17" cy="18" r="1.5" />
    </Icon>
  );
}

export function LockIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon width="20" height="20" {...props}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Icon>
  );
}

export function ChatIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon width="20" height="20" {...props}>
      <path d="M4 5h16v11H9l-5 4z" />
    </Icon>
  );
}

export function ReturnIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon width="20" height="20" {...props}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </Icon>
  );
}

/** A category tile without a picture (`home-sections.tsx`). */
export function CategoryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </Icon>
  );
}

/**
 * Sort icons (`sort-menu.tsx`): a sparkle (newest), arrows up and down (price low to high, high to low), a target (best
 * match); 20 px beside the sort's own label, which names it.
 */
export function SparkleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon width="20" height="20" {...props}>
      <path d="M11 3c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7z" />
      <path d="M19 16v5M16.5 18.5h5" />
    </Icon>
  );
}

export function ArrowUpIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon width="20" height="20" {...props}>
      <path d="M12 20V4M6 10l6-6 6 6" />
    </Icon>
  );
}

export function ArrowDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon width="20" height="20" {...props}>
      <path d="M12 4v16M6 14l6 6 6-6" />
    </Icon>
  );
}

export function TargetIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon width="20" height="20" {...props}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.5" />
    </Icon>
  );
}

/**
 * The header's theme control (`site-header.tsx`): a sun and a moon, both in the markup; `.fk-light-only` / `.fk-dark-only`
 * (app/globals.css) show the one of the theme `<html data-theme>` resolves to, by CSS only (no flash in the system mode).
 */
export function SunIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Icon>
  );
}

export function MoonIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </Icon>
  );
}
