import { cn } from "./cn";
import { VisuallyHidden } from "./visually-hidden";

export interface SpinnerProps {
  /** Accessible name, for example "Loading". */
  label: string;
  className?: string;
}

export function Spinner({ label, className }: SpinnerProps) {
  return (
    <span role="status" className="inline-flex">
      <span
        aria-hidden="true"
        className={cn(
          "inline-block size-5 animate-spin rounded-full border-2 border-border border-t-primary motion-reduce:animate-none",
          className,
        )}
      />
      <VisuallyHidden>{label}</VisuallyHidden>
    </span>
  );
}
