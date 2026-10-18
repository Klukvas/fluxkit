import { cn } from "./cn";

export interface OptionPickerValue {
  value: string;
  label: string;
  /** No sellable variant for this value with the current selection. */
  disabled?: boolean;
}

export interface OptionPickerProps {
  /** Radio group name; unique per option on the page. */
  name: string;
  legend: string;
  values: OptionPickerValue[];
  selected: string | null;
  onChange: (value: string) => void;
}

export function OptionPicker({ name, legend, values, selected, onChange }: OptionPickerProps) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="font-medium text-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {values.map((item) => (
          <label key={item.value}>
            <input
              type="radio"
              name={name}
              value={item.value}
              checked={selected === item.value}
              disabled={item.disabled}
              onChange={() => onChange(item.value)}
              className="peer sr-only"
            />
            <span
              className={cn(
                "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md border border-border bg-background px-3 text-foreground",
                "peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground",
                "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
                "peer-disabled:cursor-not-allowed peer-disabled:line-through peer-disabled:opacity-50",
              )}
            >
              {item.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
