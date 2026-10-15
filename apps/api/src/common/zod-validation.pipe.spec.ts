import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ProblemException } from "./problem.js";
import { uuidParam, ZodValidationPipe } from "./zod-validation.pipe.js";

const schema = z.strictObject({
  name: z.string().min(2),
  size: z.number().int().max(10).optional(),
  nested: z.object({ code: z.string() }).optional(),
  color: z.enum(["red", "blue"]).optional(),
  slug: z.string().superRefine((value, context) => {
    if (value !== "ok") {
      context.addIssue({
        code: "custom",
        message: "bad",
        params: { code: "invalid_format_custom" },
      });
    }
  }),
});

function failure(
  input: unknown,
  pipe: ZodValidationPipe<z.ZodType> = new ZodValidationPipe(schema),
): ProblemException {
  try {
    pipe.transform(input);
  } catch (error) {
    if (error instanceof ProblemException) return error;
    throw error;
  }
  throw new Error("Expected the pipe to reject the input");
}

describe("ZodValidationPipe", () => {
  it("returns the parsed value", () => {
    expect(new ZodValidationPipe(schema).transform({ name: "ab", slug: "ok" })).toEqual({
      name: "ab",
      slug: "ok",
    });
  });

  it("answers validation_failed (400) with one entry per issue", () => {
    const problem = failure({ name: "a", size: 11, color: "green", slug: "no" });
    expect(problem.code).toBe("validation_failed");
    expect(problem.getStatus()).toBe(400);
    expect(problem.errors?.map(({ path, code }) => ({ path, code }))).toEqual([
      { path: "name", code: "too_small" },
      { path: "size", code: "too_big" },
      { path: "color", code: "invalid_value" },
      { path: "slug", code: "invalid_format_custom" },
    ]);
  });

  it("distinguishes a missing field (required) from a wrong type (invalid_type)", () => {
    const errors = failure({ name: 5 }).errors ?? [];
    expect(errors.find((entry) => entry.path === "name")?.code).toBe("invalid_type");
    expect(errors.find((entry) => entry.path === "slug")?.code).toBe("required");
  });

  it("reports nested paths with dots", () => {
    const errors = failure({ name: "ab", slug: "ok", nested: {} }).errors ?? [];
    expect(errors).toEqual([expect.objectContaining({ path: "nested.code", code: "required" })]);
  });

  it("reports each unknown field", () => {
    const errors = failure({ name: "ab", slug: "ok", extra: 1, other: 2 }).errors ?? [];
    expect(errors).toEqual([
      { path: "extra", code: "unknown_field" },
      { path: "other", code: "unknown_field" },
    ]);
  });

  it("rejects a body that is not an object", () => {
    expect(failure("text").errors?.[0]).toMatchObject({ path: "", code: "invalid_type" });
    expect(failure(undefined).errors?.[0]).toMatchObject({ path: "", code: "required" });
  });

  it("does not leak the offending value into messages", () => {
    const secret = "s3cret-value-that-must-not-echo";
    const problem = failure({ name: "ab", slug: "ok", color: secret });
    expect(JSON.stringify(problem.errors)).not.toContain(secret);
  });
});

describe("uuidParam", () => {
  it("accepts a uuid and names the parameter in the error path", () => {
    const id = "6f1c1d2e-8b43-4f4e-9c55-0a1b2c3d4e5f";
    expect(uuidParam("id").transform(id)).toBe(id);
    expect(failure("not-a-uuid", uuidParam("id")).errors).toEqual([
      expect.objectContaining({ path: "id", code: "invalid_format" }),
    ]);
  });
});
