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
  /**
   * Where the step buttons stop (for example a stock hint), when lower than `max`. A TYPED number is clamped to `max`
   * only: above a hint it is the shopper's choice, for the server to answer.
   */
  stepMax?: number;
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

// One height for the three parts (44 px, the touch target), so the number sits on the buttons' centre line.
const buttonClasses = cn(
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-border bg-background text-lg leading-none text-foreground disabled:opacity-50",
  focusRing,
);

// The number is centred in its box: no native spin buttons (they take room on one side), tabular digits, no padding.
const inputClasses =
  "h-11 w-16 rounded-control border border-border-input bg-background p-0 text-center leading-none tabular-nums text-foreground [appearance:textfield] disabled:opacity-50 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

export function QuantityInput({
  value,
  onChange,
  label,
  decreaseLabel,
  increaseLabel,
  min = 1,
  max,
  stepMax,
  name,
  id,
  disabled,
  className,
}: QuantityInputProps) {
  const stepLimit =
    stepMax === undefined ? max : max === undefined ? stepMax : Math.min(max, stepMax);
  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      <button
        type="button"
        aria-label={decreaseLabel}
        className={buttonClasses}
        disabled={disabled || value <= min}
        onClick={() => onChange(clampQuantity(value - 1, min, stepLimit))}
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
        className={cn(inputClasses, focusRing)}
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
        disabled={disabled || (stepLimit !== undefined && value >= stepLimit)}
        onClick={() => onChange(clampQuantity(value + 1, min, stepLimit))}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
