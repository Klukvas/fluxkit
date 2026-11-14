import { cn } from "./cn";
import { VisuallyHidden } from "./visually-hidden";

export interface LoaderProps {
  label?: string;
  className?: string;
}

/** Neutral currentColor dots; a caller may announce its loading state elsewhere. */
export function Loader({ label, className }: LoaderProps) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span aria-hidden="true" className="inline-flex items-center gap-1">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            data-dot={index}
            className="fk-loader-dot size-2 rounded-full bg-current motion-reduce:animate-none"
          />
        ))}
      </span>
      {label === undefined ? null : <VisuallyHidden>{label}</VisuallyHidden>}
    </span>
  );
}
