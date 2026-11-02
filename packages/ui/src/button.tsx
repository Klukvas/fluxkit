import type { ComponentPropsWithRef } from "react";
import { cn } from "./cn";
import { focusRing } from "./styles";

export type ButtonVariant = "primary" | "secondary" | "danger";

/** `ref` is a plain prop in React 19: it reaches the `<button>` (the product page observes its add button). */
export interface ButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: ButtonVariant;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground",
  secondary: "border border-border bg-background text-foreground",
  /** Outlined, not filled: the theme has no on-danger text color, and the label says what it does. */
  danger: "border border-danger bg-background text-danger",
};

export function Button({ variant = "primary", className, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center rounded-md px-4 py-2 font-medium disabled:opacity-50",
        focusRing,
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
