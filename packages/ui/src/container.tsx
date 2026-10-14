import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export function Container({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mx-auto w-full max-w-6xl px-4", className)} {...props} />;
}
