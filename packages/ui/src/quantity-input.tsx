import { cn } from "./cn";
import { focusRing } from "./styles";

export interface QuantityInputProps {
  value: number;
  onChange: (value: number) => void;
  /** Accessible name of the number input, for example "Quantity". */
  label: string;
  decreaseLabel: string;
  increaseLabel: string;
  min?: number;
  max?: number;
  name?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}

/** Whole number inside [min, max]; the server still validates the quantity. */
export function clampQuantity(value: number, min: number, max: number | undefined): number {
  const whole = Math.trunc(value);
  const atLeastMin = Math.max(min, whole);
  return max === undefined ? atLeastMin : Math.min(max, atLeastMin);
}

const buttonClasses = cn(
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border bg-background text-foreground disabled:opacity-50",
  focusRing,
);

export function QuantityInput({
  value,
  onChange,
  label,
  decreaseLabel,
  increaseLabel,
  min = 1,
  max,
  name,
  id,
  disabled,
  className,
}: QuantityInputProps) {
  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      <button
        type="button"
        aria-label={decreaseLabel}
        className={buttonClasses}
        disabled={disabled || value <= min}
        onClick={() => onChange(clampQuantity(value - 1, min, max))}
      >
        <span aria-hidden="true">&minus;</span>
      </button>
      <input
        id={id}
        name={name}
        type="number"
        inputMode="numeric"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        className={cn(
          "min-h-11 w-16 rounded-md border border-border-input bg-background px-2 text-center text-foreground disabled:opacity-50",
          focusRing,
        )}
        onChange={(event) => {
          const next = event.currentTarget.valueAsNumber;
          if (Number.isFinite(next)) {
            onChange(clampQuantity(next, min, max));
          }
        }}
      />
      <button
        type="button"
        aria-label={increaseLabel}
        className={buttonClasses}
        disabled={disabled || (max !== undefined && value >= max)}
        onClick={() => onChange(clampQuantity(value + 1, min, max))}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
