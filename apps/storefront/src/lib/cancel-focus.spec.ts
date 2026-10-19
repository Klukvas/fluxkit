import { describe, expect, it } from "vitest";
import { cancelFocusTarget } from "./cancel-focus";
import { clientFailure } from "./failure";
import { initialOrderState, type CancelState } from "./order-store";

const idle: CancelState = initialOrderState.cancel;
const confirming: CancelState = { ...idle, confirming: true };

describe("cancelFocusTarget", () => {
  it("focuses the safe answer when the question appears", () => {
    expect(cancelFocusTarget(idle, confirming)).toBe("keep");
  });

  it("returns to the ask button when the order is kept", () => {
    expect(cancelFocusTarget(confirming, idle)).toBe("ask");
  });

  it("returns to the ask button when the cancel was refused and the question closes", () => {
    const refused: CancelState = {
      ...idle,
      failure: clientFailure("errors.rule.invalid_transition"),
    };
    expect(cancelFocusTarget({ ...confirming, pending: true }, refused)).toBe("ask");
  });

  it("focuses the message when the cancel succeeded", () => {
    expect(cancelFocusTarget({ ...confirming, pending: true }, { ...idle, done: true })).toBe(
      "status",
    );
  });

  it("moves nothing while the cancel is in flight or when nothing changed", () => {
    expect(cancelFocusTarget(confirming, { ...confirming, pending: true })).toBeNull();
    expect(cancelFocusTarget(idle, idle)).toBeNull();
    expect(cancelFocusTarget({ ...idle, done: true }, { ...idle, done: true })).toBeNull();
  });
});
