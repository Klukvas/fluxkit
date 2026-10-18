import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export type AlertVariant = "info" | "success" | "warning" | "danger";

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, "title" | "role"> {
  variant?: AlertVariant;
  title?: ReactNode;
}

const variantClasses: Record<AlertVariant, string> = {
  info: "border-primary",
  success: "border-success",
  warning: "border-warning",
  danger: "border-danger",
};

/** Only an error interrupts the screen reader (`alert`); the other variants are polite `status` messages. */
const variantRole: Record<AlertVariant, "alert" | "status"> = {
  info: "status",
  success: "status",
  warning: "status",
  danger: "alert",
};

export function Alert({ variant = "info", title, className, children, ...props }: AlertProps) {
  return (
    <div
      role={variantRole[variant]}
      className={cn(
        "rounded-md border border-s-4 border-border bg-muted p-4 text-foreground",
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children}
    </div>
  );
}
