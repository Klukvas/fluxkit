import type { ReactNode } from "react";

export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  required?: true;
}

export interface FieldProps {
  /** Id of the control; the hint and error ids derive from it. */
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** Visual marker for required fields (for example "*"); hidden from assistive technology, the native attribute does the announcing. */
  requiredIndicator?: string;
  /** Receives the props to spread on the control, so the label, hint and error are linked to it. */
  children: (control: FieldControlProps) => ReactNode;
}

export function Field({
  id,
  label,
  hint,
  error,
  required,
  requiredIndicator,
  children,
}: FieldProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");
  const control: FieldControlProps = {
    id,
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
    ...(error ? { "aria-invalid": true as const } : {}),
    ...(required ? { required: true as const } : {}),
  };
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium text-foreground">
        {label}
        {required && requiredIndicator ? (
          <span aria-hidden="true" className="ms-1 text-danger">
            {requiredIndicator}
          </span>
        ) : null}
      </label>
      {hint ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {children(control)}
      {error ? (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
