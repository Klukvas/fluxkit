import type { TypeChangeDecision } from "@fluxkit/core";
import { ruleViolation } from "../../common/problem.js";

/** Turns a rejected core change decision into `409 rule_violation` whose `rule` is the core reason code. */
export function assertAllowed(decision: TypeChangeDecision, detail: string): void {
  if (!decision.allowed) {
    throw ruleViolation(detail, decision.reason);
  }
}

/** For statements that must return a row (an insert with `returning`). */
export function required<T>(row: T | undefined): T {
  if (row === undefined) {
    throw new Error("The database returned no row for a statement that must return one.");
  }
  return row;
}
