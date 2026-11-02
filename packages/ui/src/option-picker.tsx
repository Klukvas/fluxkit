import { Fragment } from "react";
import { cn } from "./cn";

export interface OptionPickerValue {
  value: string;
  label: string;
  /** No sellable variant for this value with the current selection: it cannot be chosen. */
  disabled?: boolean;
  /**
   * The variant this value leads to exists but is out of stock (review D-15). It stays selectable (the shopper sees its
   * price and the "out of stock" state), is struck through, and `soldOutLabel` is read with it.
   */
  soldOut?: boolean;
}

export interface OptionPickerProps {
  /** Radio group name; unique per option on the page. */
  name: string;
  legend: string;
  values: OptionPickerValue[];
  selected: string | null;
  onChange: (value: string) => void;
  /** Spoken after the label of a `soldOut` value, for example "out of stock". Required when a value is sold out. */
  soldOutLabel?: string;
}

export function OptionPicker({
  name,
  legend,
  values,
  selected,
  onChange,
  soldOutLabel,
}: OptionPickerProps) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="font-medium text-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {values.map((item) => {
          const soldOut = item.soldOut === true && item.disabled !== true;
          // The "out of stock" word is the radio's description, not part of its name: the value is still called "L".
          const describedBy = soldOut && soldOutLabel ? `${name}-${item.value}-sold-out` : null;
          return (
            <Fragment key={item.value}>
              <label>
                <input
                  type="radio"
                  name={name}
                  value={item.value}
                  checked={selected === item.value}
                  disabled={item.disabled}
                  onChange={() => onChange(item.value)}
                  aria-describedby={describedBy ?? undefined}
                  className="peer sr-only"
                />
                <span
                  className={cn(
                    "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md border border-border bg-background px-3 text-foreground peer-not-checked:hover:border-border-input",
                    "peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground",
                    "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
                    "peer-disabled:cursor-not-allowed peer-disabled:line-through peer-disabled:opacity-50",
                    soldOut ? "border-dashed text-muted-foreground line-through" : null,
                  )}
                >
                  {item.label}
                </span>
              </label>
              {describedBy === null ? null : (
                // Outside the label and `hidden`: not part of the value's name, read through `aria-describedby`.
                <span id={describedBy} hidden>
                  {soldOutLabel}
                </span>
              )}
            </Fragment>
          );
        })}
      </div>
    </fieldset>
  );
}
