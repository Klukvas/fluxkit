"use client";

import { useState } from "react";
import { cn } from "./cn";
import { VisuallyHidden } from "./visually-hidden";

export interface NumberRollProps {
  value: number;
  className?: string;
  accessibleLabel?: string;
  decorative?: boolean;
}

export function numberRollDirection(previous: number, next: number): "up" | "down" {
  return next > previous ? "up" : "down";
}

/** The previous digit is painted by CSS so only the current value contributes to text content. */
export function NumberRoll({
  value,
  className,
  accessibleLabel,
  decorative = false,
}: NumberRollProps) {
  const [frame, setFrame] = useState({ value, previous: value, changed: false });
  if (frame.value !== value) setFrame({ value, previous: frame.value, changed: true });
  return (
    <span
      className={cn(
        "fk-number-roll relative inline-grid overflow-hidden align-bottom tabular-nums",
        className,
      )}
    >
      {decorative ? null : <VisuallyHidden>{accessibleLabel ?? value}</VisuallyHidden>}
      <span
        key={frame.value}
        aria-hidden="true"
        data-direction={numberRollDirection(frame.previous, frame.value)}
        data-rolling={frame.changed}
        data-previous={frame.previous}
        className="fk-number-frame relative col-start-1 row-start-1 inline-grid"
      >
        <span className="fk-number-new">{frame.value}</span>
      </span>
    </span>
  );
}
