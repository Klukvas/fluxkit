import { describe, expect, it } from "vitest";
import { eventErrorCode, HandlerTimeoutError } from "./event-error-code.js";

// The CHECK of domain_event.last_error_code.
const DATABASE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

describe("eventErrorCode", () => {
  it("is the class of the error and never its message", () => {
    const code = eventErrorCode(new TypeError("secret buyer@example.test"));
    expect(code).toBe("TypeError");
    expect(code).not.toContain("secret");
  });

  it("adds the code of the innermost cause when there is one", () => {
    expect(eventErrorCode(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe(
      "Error:ECONNRESET",
    );
    expect(
      eventErrorCode(
        new Error("outer", { cause: Object.assign(new Error("in"), { code: 23505 }) }),
      ),
    ).toBe("Error:23505");
  });

  it("names a timeout and a thrown non-error", () => {
    expect(eventErrorCode(new HandlerTimeoutError())).toBe("HandlerTimeout");
    expect(eventErrorCode("a string")).toBe("NonError");
    expect(eventErrorCode(undefined)).toBe("NonError");
  });

  it("always fits the database CHECK, whatever the class is called", () => {
    class Weird extends Error {}
    Object.defineProperty(Weird, "name", { value: "Weird class with spaces & symbols/é" });
    const long = Object.assign(new Error("x"), { code: "E".repeat(200) });
    for (const error of [new Weird("x"), long]) {
      const code = eventErrorCode(error);
      expect(code).toMatch(DATABASE_PATTERN);
    }
    expect(eventErrorCode(new Weird("x"))).toBe("Weird_class_with_spaces___symbols__");
    expect(eventErrorCode(long)).toHaveLength(64);
  });
});
