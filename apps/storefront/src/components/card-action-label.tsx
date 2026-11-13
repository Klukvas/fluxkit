/**
 * The visible words of a card's purchase action (owner report 2026-11-13, CI at 320 px): the short label on a phone, the full
 * one from `sm`, always on ONE line (cut with an ellipsis rather than wrapped), so the action keeps its 44 px height whatever
 * the font and the prices of a row stay on one line. The hidden copy is `display: none`, so the accessible name is the
 * visible words only; the product's title follows it, visually hidden, in the caller.
 */
export function CardActionLabel({ short, full }: { short: string; full: string }) {
  return (
    <span className="min-w-0 truncate">
      <span className="sm:hidden">{short}</span>
      <span className="max-sm:hidden">{full}</span>
    </span>
  );
}
