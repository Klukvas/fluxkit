import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "./cn";
import { focusRing } from "./styles";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
/** `md` is the default size; `lg` is the 48 px call to action (product page, mobile bars). */
export type ButtonSize = "md" | "lg";

/** `ref` is a plain prop in React 19: it reaches the `<button>` (the product page observes its add button). */
export interface ButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

/** Hover only on an enabled button: a disabled one must not look pressable. Hover surfaces are tested contrast pairs. */
export const buttonVariantClasses: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground enabled:hover:bg-primary/90",
  ghost: "bg-background text-foreground enabled:hover:bg-muted",
  secondary: "border-2 border-foreground bg-background text-foreground enabled:hover:bg-muted",
  /** Outlined, not filled: the label says what it does; `danger` text on `muted` is a tested pair. */
  danger: "border-2 border-danger bg-background text-danger enabled:hover:bg-muted",
};

const sizeClasses: Record<ButtonSize, string> = {
  md: "px-4 py-2",
  lg: "min-h-12 px-6 py-2 text-lg",
};

export function Button({
  variant = "primary",
  size = "md",
  icon,
  children,
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center rounded-control font-medium disabled:opacity-50",
        sizeClasses[size],
        focusRing,
        buttonVariantClasses[variant],
        icon != null && "gap-2",
        className,
      )}
      {...props}
    >
      {icon != null ? (
        <>
          <span
            aria-hidden="true"
            className="inline-flex size-5 shrink-0 items-center justify-center"
          >
            {icon}
          </span>
          {children}
        </>
      ) : (
        children
      )}
    </button>
  );
}
