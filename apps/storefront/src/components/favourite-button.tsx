"use client";

import { useState } from "react";

/**
 * FORK client island: the favourite heart of the product card (rendered by the server slot component `FavouriteAction`).
 * TODO(fluxkit): a placeholder: it only toggles its own pressed state, nothing is stored (no wishlist feature yet).
 */
export function FavouriteButton({ label }: { label: string }) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={() => setPressed(!pressed)}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full bg-background text-foreground shadow-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill={pressed ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      >
        <path d="M12 21s-7.5-4.6-9.5-9.2C1.2 8.6 3.3 5 6.8 5c2 0 3.4 1.1 4.2 2.4h2C13.8 6.1 15.2 5 17.2 5c3.5 0 5.6 3.6 4.3 6.8C19.5 16.4 12 21 12 21z" />
      </svg>
    </button>
  );
}
