"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./button";
import { cn } from "./cn";
import { createToastTimer, type ToastTimer } from "./toast-timer";

export type ToastTone = "neutral" | "success" | "danger";
export interface ToastProps {
  message: ReactNode;
  tone?: ToastTone;
  action?: ReactNode;
  dismissLabel: string;
  /** A reading time in milliseconds, independent of motion preferences. */
  lifetime: number;
  onDismiss: () => void;
}

/** Mount this once, even while empty, so future list additions are announced. */
export function ToastStack({ children }: { children?: ReactNode }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-relevant="additions text"
      className="fk-toast-stack pointer-events-none fixed inset-x-0 bottom-0 z-50 p-4 sm:start-auto sm:w-full sm:max-w-md"
    >
      <ul className="flex flex-col gap-3">{children}</ul>
    </div>
  );
}

const tones: Record<ToastTone, string> = {
  neutral: "border-border",
  success: "border-success",
  danger: "border-danger",
};

const barTones: Record<ToastTone, string> = {
  neutral: "bg-foreground",
  success: "bg-success",
  danger: "bg-danger",
};

/** Bind the decorative bar to the reading clock without making the pure timer depend on the DOM. */
export function createToastClock(
  bar: Pick<HTMLElement, "animate" | "hidden"> | null,
  lifetime: number,
  onElapsed: () => void,
  reducedMotion: boolean,
): ToastTimer {
  const animation =
    !reducedMotion && typeof bar?.animate === "function"
      ? bar.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], {
          duration: lifetime,
          fill: "forwards",
        })
      : null;
  if (bar) bar.hidden = animation === null;
  const clock = createToastTimer(lifetime, onElapsed);
  let holds: readonly string[] = [];
  return {
    pause(reason) {
      if (holds.includes(reason)) return;
      if (holds.length === 0) animation?.pause();
      holds = [...holds, reason];
      clock.pause(reason);
    },
    resume(reason) {
      if (!holds.includes(reason)) return;
      holds = holds.filter((hold) => hold !== reason);
      clock.resume(reason);
      if (holds.length === 0) animation?.play();
    },
    dispose() {
      clock.dispose();
      animation?.cancel();
    },
    remaining: clock.remaining,
  };
}

/** The timer and life bar pause together; keyboard focus continues holding after the pointer leaves. */
export function Toast({
  message,
  tone = "neutral",
  action,
  dismissLabel,
  lifetime,
  onDismiss,
}: ToastProps) {
  const callback = useRef(onDismiss);
  callback.current = onDismiss;
  const timer = useRef<ToastTimer | null>(null);
  const bar = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const clock = createToastClock(
      bar.current,
      lifetime,
      () => callback.current(),
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    );
    timer.current = clock;
    return () => {
      clock.dispose();
      timer.current = null;
    };
  }, [lifetime]);
  return (
    <li
      className={cn(
        "fk-toast-item pointer-events-auto relative overflow-hidden rounded-overlay border bg-background p-4 shadow-overlay text-foreground",
        tones[tone],
      )}
      onMouseEnter={() => {
        timer.current?.pause("hover");
      }}
      onMouseLeave={() => {
        timer.current?.resume("hover");
      }}
      onFocusCapture={() => {
        timer.current?.pause("focus");
      }}
      onBlurCapture={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        )
          return;
        timer.current?.resume("focus");
      }}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p>{message}</p>
          {action}
        </div>
        <Button
          variant="secondary"
          className="min-h-11 min-w-11"
          aria-label={dismissLabel}
          onClick={onDismiss}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </Button>
      </div>
      <span
        ref={bar}
        aria-hidden="true"
        className={cn("fk-toast-life absolute inset-x-0 bottom-0 h-1 origin-left", barTones[tone])}
      />
    </li>
  );
}
