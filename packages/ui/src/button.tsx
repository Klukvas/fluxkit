import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";
import { focusRing } from "./styles";

export type ButtonVariant = "primary" | "secondary";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground",
  secondary: "border border-border bg-background text-foreground",
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
