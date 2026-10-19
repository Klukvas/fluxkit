import { InvalidResponseError, NetworkError, type StoreFailure } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import { createTranslator } from "@fluxkit/ui";
import { vi } from "vitest";
import en from "../messages/en.json";
import uk from "../messages/uk.json";
import {
  failureFromResult,
  failureFromThrown,
  failureText,
  focusAfterFailure,
  focusTarget,
  missingRequired,
  retryAfterSeconds,
} from "./failure";

function failed(
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
  retryAfter: string | null = null,
): StoreFailure {
  return {
    ok: false,
    status,
    retryAfter,
    problem: {
      type: "about:blank",
      title: "t",
      status,
      code,
      detail: "English detail, never shown",
      ...extra,
    } as StoreFailure["problem"],
  };
}

describe("retryAfterSeconds", () => {
  it.each([
    ["30", 30],
    ["1", 1],
    [" 12 ", 12],
    ["86400", 86400],
    ["999999999", 86400],
  ])("reads %j as %j seconds", (raw, seconds) => {
    expect(retryAfterSeconds(raw)).toBe(seconds);
  });

  it.each([null, undefined, "", "0", "-5", "1.5", "abc", "Wed, 21 Oct 2026 07:28:00 GMT", "1e3"])(
    "reads %j as no usable wait",
    (raw) => {
      expect(retryAfterSeconds(raw)).toBeNull();
    },
  );
});

describe("failureFromResult", () => {
  it("shows the translated message of the problem code and never the API's text", () => {
    const failure = failureFromResult(failed(409, "rule_violation", { rule: "quantity_limit" }));
    expect(failure).toMatchObject({
      messageKey: "errors.rule.quantity_limit",
      status: 409,
      code: "rule_violation",
      retryAfterSeconds: null,
      fieldErrors: [],
    });
    expect(JSON.stringify(failure)).not.toContain("English detail");
  });

  it("carries Retry-After of a 429", () => {
    expect(failureFromResult(failed(429, "too_many_requests", {}, "42"))).toMatchObject({
      messageKey: "errors.too_many_requests",
      retryAfterSeconds: 42,
    });
  });

  it("maps validation errors to field messages by code, in the order the API gave them", () => {
    const failure = failureFromResult(
      failed(400, "validation_failed", {
        errors: [
          { path: "password", code: "too_short", message: "English, never shown" },
          { path: "email", code: "invalid_format" },
          { path: "firstName", code: "a_code_from_the_future" },
        ],
      }),
    );
    expect(failure.fieldErrors).toEqual([
      { path: "password", code: "too_short", messageKey: "errors.field.too_short" },
      { path: "email", code: "invalid_format", messageKey: "errors.field.invalid_format" },
      { path: "firstName", code: "a_code_from_the_future", messageKey: "errors.generic" },
    ]);
    expect(JSON.stringify(failure)).not.toContain("never shown");
  });

  it("turns a conflict on a field into a field error", () => {
    const failure = failureFromResult(failed(409, "conflict", { field: "email" }));
    expect(failure.fieldErrors).toEqual([
      { path: "email", code: "conflict", messageKey: "errors.conflict" },
    ]);
    expect(failure.messageKey).toBe("errors.conflict");
  });
});

describe("failureFromThrown", () => {
  it("reports a network failure and an unreadable answer as translated failures", () => {
    const network = new NetworkError("down", {
      cause: new TypeError("fetch failed"),
      aborted: false,
    });
    expect(failureFromThrown(network)).toMatchObject({
      messageKey: "errors.network",
      status: null,
      code: null,
      fieldErrors: [],
    });
    expect(failureFromThrown(new InvalidResponseError("html", { status: 502 }))).toMatchObject({
      messageKey: "errors.invalidResponse",
      status: 502,
    });
  });

  it("reports a timeout as a retryable failure with its own message (the request may or may not have arrived)", () => {
    const timeout = new NetworkError("slow", {
      cause: new DOMException("The operation timed out.", "TimeoutError"),
      aborted: true,
    });
    expect(failureFromThrown(timeout)).toMatchObject({
      messageKey: "errors.timeout",
      status: null,
      code: null,
      fieldErrors: [],
    });
    // The same when the client did not mark it as aborted (the signal was not the caller's own).
    const unmarked = new NetworkError("slow", {
      cause: new DOMException("The operation timed out.", "TimeoutError"),
      aborted: false,
    });
    expect(failureFromThrown(unmarked)).toMatchObject({ messageKey: "errors.timeout" });
  });

  it("rethrows an abort and anything unexpected instead of hiding it", () => {
    const aborted = new NetworkError("aborted", { cause: new Error("x"), aborted: true });
    expect(() => failureFromThrown(aborted)).toThrow(aborted);
    const bug = new TypeError("a bug");
    expect(() => failureFromThrown(bug)).toThrow(bug);
  });
});

describe("focusTarget", () => {
  const order = ["email", "password", "firstName"];

  it("focuses the first invalid field in page order, not in the order of the answer", () => {
    const failure = failureFromResult(
      failed(400, "validation_failed", {
        errors: [
          { path: "firstName", code: "empty" },
          { path: "password", code: "too_short" },
        ],
      }),
    );
    expect(focusTarget(failure, order)).toEqual({ kind: "field", path: "password" });
  });

  it("focuses the error summary when no listed field is invalid", () => {
    expect(focusTarget(failureFromResult(failed(429, "too_many_requests")), order)).toEqual({
      kind: "summary",
    });
    const unknownField = failureFromResult(
      failed(400, "validation_failed", { errors: [{ path: "somethingElse", code: "invalid" }] }),
    );
    expect(focusTarget(unknownField, order)).toEqual({ kind: "summary" });
  });
});

describe("missingRequired", () => {
  it("reports blank required fields as required errors without a request, trimming spaces", () => {
    const failure = missingRequired({ email: "  ", password: "", firstName: "Ada" }, [
      "email",
      "password",
      "firstName",
    ]);
    expect(failure).not.toBeNull();
    expect(failure?.fieldErrors.map((error) => error.path)).toEqual(["email", "password"]);
    expect(
      failure?.fieldErrors.every((error) => error.messageKey === "errors.field.required"),
    ).toBe(true);
  });

  it("does not trim a password (spaces are part of it) but still needs one character", () => {
    expect(missingRequired({ password: "   " }, ["password"])).toBeNull();
    expect(missingRequired({ password: "" }, ["password"])).not.toBeNull();
  });

  it("is null when everything is filled in", () => {
    expect(missingRequired({ email: "a@b.test" }, ["email"])).toBeNull();
  });
});

describe("failureText", () => {
  it("is the translated message, with the wait appended for a 429 in both languages", () => {
    const failure = failureFromResult(failed(429, "too_many_requests", {}, "90"));
    const english = failureText(createTranslator(en, "en"), failure);
    expect(english).toContain("Too many attempts");
    expect(english).toMatch(/90/);
    const ukrainian = failureText(createTranslator(uk, "uk"), failure);
    expect(ukrainian).toMatch(/90/);
    expect(ukrainian).not.toBe(english);
    const plain = failureFromResult(failed(500, "internal_error"));
    expect(failureText(createTranslator(en, "en"), plain)).toBe(
      createTranslator(en, "en")("errors.internal_error"),
    );
  });
});

describe("focusAfterFailure", () => {
  const ids = { email: "form-email", password: "form-password" };
  const invalid = failureFromResult(
    failed(400, "validation_failed", { errors: [{ path: "password", code: "too_short" }] }),
  );

  it("focuses the first invalid field's element", () => {
    const focus = vi.fn();
    const summary = { focus: vi.fn() };
    const doc = { getElementById: vi.fn(() => ({ focus })) };
    expect(focusAfterFailure(invalid, ["email", "password"], ids, summary, doc)).toEqual({
      kind: "field",
      path: "password",
    });
    expect(doc.getElementById).toHaveBeenCalledWith("form-password");
    expect(focus).toHaveBeenCalledTimes(1);
    expect(summary.focus).not.toHaveBeenCalled();
  });

  it("focuses the summary when no field is invalid, or the field's element is gone", () => {
    const summary = { focus: vi.fn() };
    const doc = { getElementById: vi.fn(() => null) };
    const plain = failureFromResult(failed(429, "too_many_requests"));
    expect(focusAfterFailure(plain, ["email"], ids, summary, doc)).toEqual({ kind: "summary" });
    expect(focusAfterFailure(invalid, ["email", "password"], ids, summary, doc)).toEqual({
      kind: "summary",
    });
    expect(summary.focus).toHaveBeenCalledTimes(2);
  });

  it("does nothing, and says so, when there is nothing to focus", () => {
    const doc = { getElementById: () => null };
    expect(focusAfterFailure(invalid, ["password"], ids, null, doc)).toBeNull();
  });
});
