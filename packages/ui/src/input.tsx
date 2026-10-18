import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "./cn";
import { controlBase, focusRing } from "./styles";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = "text", ...props },
  ref,
) {
  return (
    <input ref={ref} type={type} className={cn(controlBase, focusRing, className)} {...props} />
  );
});
