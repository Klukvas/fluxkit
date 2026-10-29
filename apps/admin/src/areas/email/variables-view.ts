import type { JsonObject } from "@fluxkit/api-client";

/**
 * The stored template input of a mail as a flat list of rows for display. The API redacts it (`[redacted]` for every key
 * its template does not declare displayable and for account mails, texts cut to 200 characters); the screen shows what
 * it gets and marks a redacted value as hidden, it never tries to restore one. Every value is text for a text node.
 */

/** The marker the API writes for a hidden value (`docs/api/email.md`, "A message"). */
export const REDACTED_MARKER = "[redacted]";

/** Rows shown at most; a mail's variables are small, this only bounds a hostile or odd stored shape. */
export const MAX_VARIABLE_ROWS = 200;

export type VariableValue =
  { kind: "redacted" } | { kind: "empty" } | { kind: "text"; text: string };

export interface VariableRow {
  /** Dotted path of the value (order.number, items.0.title). */
  path: string;
  value: VariableValue;
}

export interface VariableRows {
  rows: VariableRow[];
  /** More values exist than `MAX_VARIABLE_ROWS`. */
  truncated: boolean;
}

function valueOf(value: unknown): VariableValue {
  if (value === REDACTED_MARKER) return { kind: "redacted" };
  if (value === null || value === undefined) return { kind: "empty" };
  if (typeof value === "string")
    return value === "" ? { kind: "empty" } : { kind: "text", text: value };
  return { kind: "text", text: String(value) };
}

export function variableRows(variables: JsonObject): VariableRows {
  if (Object.keys(variables).length === 0) return { rows: [], truncated: false };
  const rows: VariableRow[] = [];
  let truncated = false;
  function walk(value: unknown, path: string): void {
    if (rows.length >= MAX_VARIABLE_ROWS) {
      truncated = true;
      return;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) rows.push({ path, value: { kind: "empty" } });
      value.forEach((item, index) => walk(item, `${path}.${String(index)}`));
    } else if (typeof value === "object" && value !== null) {
      const entries = Object.entries(value);
      if (entries.length === 0) rows.push({ path, value: { kind: "empty" } });
      for (const [key, item] of entries) walk(item, path === "" ? key : `${path}.${key}`);
    } else {
      rows.push({ path, value: valueOf(value) });
    }
  }
  walk(variables, "");
  return { rows, truncated };
}
