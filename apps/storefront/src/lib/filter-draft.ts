/**
 * The filter form's "changed, not applied yet" state (owner request 2026-11-02: an "Apply filters" button floats next to the
 * control the shopper changed). Pure: the island passes the form's controls and the measured boxes.
 *
 * A control is changed when its value differs from the value the page was rendered with: the browser keeps that as
 * `defaultChecked`, `defaultValue` and `defaultSelected`, so no copy of the form is kept and a new page (new defaults)
 * starts clean.
 */

export interface DraftControl {
  type: string;
  checked?: boolean;
  defaultChecked?: boolean;
  value?: string;
  defaultValue?: string;
  options?: ArrayLike<{ selected: boolean; defaultSelected: boolean }>;
}

export function isControlChanged(control: DraftControl): boolean {
  if (control.type === "checkbox" || control.type === "radio") {
    return control.checked !== control.defaultChecked;
  }
  if (control.options !== undefined) {
    return Array.from(control.options).some((option) => option.selected !== option.defaultSelected);
  }
  if (control.type === "hidden" || control.type === "submit" || control.type === "button") {
    return false;
  }
  return (control.value ?? "") !== (control.defaultValue ?? "");
}

/** The form differs from the rendered page: at least one control changed. */
export function isFormChanged(controls: Iterable<DraftControl>): boolean {
  for (const control of controls) {
    if (isControlChanged(control)) return true;
  }
  return false;
}

/**
 * Where the floating button goes, in pixels from the top of the form: centred on the changed control's row, kept inside
 * the form.
 */
export function floatingTop(
  row: { top: number; height: number },
  form: { top: number; height: number },
  buttonHeight: number,
): number {
  const centred = row.top - form.top + (row.height - buttonHeight) / 2;
  const lowest = Math.max(0, form.height - buttonHeight);
  return Math.min(Math.max(0, centred), lowest);
}
