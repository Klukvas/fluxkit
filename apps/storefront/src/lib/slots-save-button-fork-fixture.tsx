"use client";

import { useState } from "react";

/**
 * Test data of the fork runs (with `slots-fork-fixture.tsx`): the client island of a card action, as a fork's "save" heart would
 * be. A slot cannot register it directly (it could not receive the translator); the server component `ForkSaveAction` renders it
 * with plain, already translated props. TODO(fluxkit): a placeholder: it only toggles its own pressed state, nothing is stored.
 */
export function ForkSaveButton({ label, text }: { label: string; text: string }) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={() => setPressed(!pressed)}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control bg-background px-2 text-sm text-foreground shadow-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {text}
    </button>
  );
}
