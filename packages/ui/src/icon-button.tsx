import type { ComponentPropsWithRef, ReactNode } from "react";
import { buttonVariantClasses, type ButtonSize, type ButtonVariant } from "./button";
import { cn } from "./cn";
import { focusRing } from "./styles";

export interface IconButtonProps extends Omit<
  ComponentPropsWithRef<"button">,
  "children" | "aria-label" | "aria-labelledby"
> {
  children?: never;
  "aria-label"?: never;
  "aria-labelledby"?: never;
  label: string;
  icon: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** A translated name and a decorative icon on a square native button. */
export function IconButton({
  label,
  icon,
  variant = "ghost",
  size = "md",
  className,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      {...props}
      type={type}
      aria-label={label}
      className={cn(
        "inline-flex items-center justify-center rounded-control font-medium disabled:opacity-50",
        size === "md" ? "size-11" : "size-12",
        focusRing,
        buttonVariantClasses[variant],
        className,
      )}
    >
      <span aria-hidden="true" className="inline-flex size-5 shrink-0 items-center justify-center">
        {icon}
      </span>
    </button>
  );
}
