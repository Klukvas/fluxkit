"use client";

import { Button, type ButtonProps } from "./button";
import { cn } from "./cn";
import { Loader } from "./loader";
import { VisuallyHidden } from "./visually-hidden";
import type { ReactNode } from "react";

export interface ActionButtonProps extends Omit<ButtonProps, "children"> {
  state: "idle" | "loading" | "done";
  idleLabel: ReactNode;
  loadingLabel: ReactNode;
  doneLabel: ReactNode;
  accessibleSuffix?: ReactNode;
  /**
   * Opt in only where labels can overflow (e.g. a narrow card): a clipping box inside a button
   * changes Chromium's text painting of following content.
   */
  truncateLabels?: boolean;
}

/** All labels reserve width in the same cell; only the current one contributes to the accessible name. */
export function ActionButton({
  state,
  idleLabel,
  loadingLabel,
  doneLabel,
  accessibleSuffix,
  truncateLabels = false,
  className,
  onClick,
  ...props
}: ActionButtonProps) {
  const labels = { idle: idleLabel, loading: loadingLabel, done: doneLabel };
  return (
    <Button
      {...props}
      disabled={state === "loading" ? false : props.disabled}
      className={cn("fk-action-button", className)}
      aria-disabled={state === "loading" ? true : (props["aria-disabled"] ?? false)}
      aria-busy={state === "loading"}
      onClick={(event) => {
        if (state === "loading") {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    >
      <span className="grid grid-cols-1 min-w-0 max-w-full">
        {(["idle", "loading", "done"] as const).map((labelState) => (
          <span
            key={labelState}
            aria-hidden={state !== labelState}
            data-visible={state === labelState}
            className="fk-action-label col-start-1 row-start-1 inline-flex min-w-0 items-center justify-center gap-2"
          >
            {labelState === "loading" ? <Loader className="shrink-0" /> : null}
            {labelState === "done" ? (
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="fk-action-check size-5 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="m5 12 4 4L19 6" />
              </svg>
            ) : null}
            {truncateLabels ? (
              <span className="min-w-0 truncate">{labels[labelState]}</span>
            ) : (
              labels[labelState]
            )}
          </span>
        ))}
      </span>
      {accessibleSuffix === undefined ? null : <VisuallyHidden> {accessibleSuffix}</VisuallyHidden>}
    </Button>
  );
}
