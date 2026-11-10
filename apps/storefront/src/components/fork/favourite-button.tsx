"use client";

import { useState } from "react";

/**
 * FORK (reshape R1): the favourite heart of a product card. A client island the server cards render with plain, already
 * translated props (`components/cards/portrait-grid-card.tsx`, `horizontal-list-card.tsx`).
 *
 * TODO(fluxkit): a PLACEHOLDER. The template has no wishlist feature: the button only toggles its own pressed state, nothing
 * is stored and the state is lost on the next page. A real one is a feature module (AGENTS.md section 2.1).
 */
export function FavouriteButton({ label }: { label: string }) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={() => setPressed(!pressed)}
      className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full bg-background text-foreground shadow-card hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        aria-hidden="true"
        focusable="false"
        fill={pressed ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 20.5 4.6 13a4.8 4.8 0 0 1 6.8-6.8l.6.6.6-.6a4.8 4.8 0 0 1 6.8 6.8Z" />
      </svg>
    </button>
  );
}
