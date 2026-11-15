/** Shared decorative empty-cart illustration; motion is entirely CSS and token driven. */
export function EmptyCartIllustration() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 96 96"
      className="size-24 shrink-0 text-muted-foreground"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <g className="fk-empty-cart-float">
        <path className="fill-muted" d="M24 32h48l-5 40H29Z" />
        <path d="M35 37V25a13 13 0 0 1 26 0v12" />
      </g>
    </svg>
  );
}
