"use client";

import { useState } from "react";

/**
 * The heart on the fork's product card. A client island: the card is a server component and renders this with plain, already
 * translated props. TODO(fluxkit): a placeholder. It only toggles its own pressed state in the browser; nothing is stored, and
 * there is no wishlist feature behind it yet (a wishlist would be an optional feature module, `AGENTS.md` section 2.1).
 */
export function FavouriteButton({ label }: { label: string }) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={() => setPressed(!pressed)}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full bg-background text-foreground shadow-card hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <svg
        viewBox="0 0 24 24"
        width="24"
        height="24"
        aria-hidden="true"
        focusable="false"
        className={pressed ? "fk-icon fill-danger text-danger" : "fk-icon"}
      >
        <path d="M12 20.5s-8-4.6-8-10.4A4.6 4.6 0 0 1 12 7.3a4.6 4.6 0 0 1 8 2.8c0 5.8-8 10.4-8 10.4Z" />
      </svg>
    </button>
  );
}
