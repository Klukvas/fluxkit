import { describe, expect, it } from "vitest";
import { MAX_VARIABLE_ROWS, REDACTED_MARKER, variableRows } from "./variables-view";

describe("variableRows (the redacted variables of a mail)", () => {
  it("flattens nested objects and arrays into dotted paths", () => {
    expect(
      variableRows({
        orderNumber: "ORD-1",
        lines: [{ title: "Mug", quantity: 2 }],
        paid: true,
      }).rows,
    ).toEqual([
      { path: "orderNumber", value: { kind: "text", text: "ORD-1" } },
      { path: "lines.0.title", value: { kind: "text", text: "Mug" } },
      { path: "lines.0.quantity", value: { kind: "text", text: "2" } },
      { path: "paid", value: { kind: "text", text: "true" } },
    ]);
  });

  it("marks the API's [redacted] marker as hidden and never turns it into a value", () => {
    const { rows } = variableRows({
      customerName: REDACTED_MARKER,
      order: { link: REDACTED_MARKER },
    });
    expect(rows).toEqual([
      { path: "customerName", value: { kind: "redacted" } },
      { path: "order.link", value: { kind: "redacted" } },
    ]);
    expect(JSON.stringify(rows)).not.toContain(REDACTED_MARKER);
  });

  it("shows null, empty text, empty arrays and empty objects as empty", () => {
    expect(
      variableRows({ a: null, b: "", c: [], d: {} }).rows.map((row) => row.value.kind),
    ).toEqual(["empty", "empty", "empty", "empty"]);
  });

  it("has no rows for no variables", () => {
    expect(variableRows({})).toEqual({ rows: [], truncated: false });
  });

  it("keeps a hostile text as plain text (it is rendered as a text node)", () => {
    const hostile = '<img src=x onerror="alert(1)">';
    expect(variableRows({ note: hostile }).rows[0]?.value).toEqual({ kind: "text", text: hostile });
  });

  it("stops at the row limit and says so", () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_VARIABLE_ROWS + 5 }, (_, index) => [`k${String(index)}`, "v"]),
    );
    const result = variableRows(many);
    expect(result.rows).toHaveLength(MAX_VARIABLE_ROWS);
    expect(result.truncated).toBe(true);
  });
});
