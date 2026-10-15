import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import pg from "pg";
import { describe, expect, it } from "vitest";
import * as schema from "../database/schema/index.js";
import {
  findPostgresError,
  isUniqueViolation,
  mapPostgresError,
  translatePostgresError,
} from "./postgres-errors.js";
import { ProblemException } from "./problem.js";

function pgError(code: string, constraint?: string): pg.DatabaseError {
  const error = new pg.DatabaseError("message text that must never be parsed", 0, "error");
  error.code = code;
  error.constraint = constraint;
  return error;
}

/** Drizzle throws `DrizzleQueryError` with the driver error as `cause`. */
function wrapped(error: Error): Error {
  return new Error("Failed query: insert into ...", { cause: error });
}

describe("mapPostgresError", () => {
  it("maps 23505 to conflict with the constraint and the field", () => {
    const problem = mapPostgresError(wrapped(pgError("23505", "brand_slug_key")));
    expect(problem).toBeInstanceOf(ProblemException);
    expect(problem).toMatchObject({
      code: "conflict",
      extensions: { field: "slug", constraint: "brand_slug_key" },
    });
    expect(problem?.getStatus()).toBe(409);
  });

  it("converts snake_case columns to camelCase field names", () => {
    expect(mapPostgresError(pgError("23505", "attribute_code_key"))).toMatchObject({
      extensions: { field: "code" },
    });
  });

  it("gives no field for composite constraints, but still the constraint name", () => {
    expect(mapPostgresError(pgError("23505", "product_category_pkey"))).toMatchObject({
      code: "conflict",
      extensions: { constraint: "product_category_pkey" },
    });
    expect(
      mapPostgresError(pgError("23505", "product_category_pkey"))?.extensions,
    ).not.toHaveProperty("field");
  });

  it("maps 23503 to in_use by default and to validation_failed for invalid references", () => {
    expect(mapPostgresError(pgError("23503", "product_brand_id_fkey"))).toMatchObject({
      code: "in_use",
      extensions: { constraint: "product_brand_id_fkey" },
    });
    expect(
      mapPostgresError(pgError("23503", "product_brand_id_fkey"), {
        foreignKey: "invalid_reference",
      }),
    ).toMatchObject({
      code: "validation_failed",
      errors: [{ path: "", code: "invalid_reference" }],
    });
  });

  it("maps 23514 to validation_failed with the constraint name", () => {
    expect(mapPostgresError(pgError("23514", "brand_slug_check"))).toMatchObject({
      code: "validation_failed",
      errors: [{ path: "", code: "check_violation" }],
      extensions: { constraint: "brand_slug_check" },
    });
  });

  it("uses the SQLSTATE and constraint name only, never the message text", () => {
    const misleading = pgError("23505", "brand_slug_key");
    misleading.message = 'update or delete on table "x" violates foreign key constraint';
    expect(mapPostgresError(misleading)?.code).toBe("conflict");
  });

  it("allows a caller-specific detail", () => {
    expect(mapPostgresError(pgError("23503"), { detail: "Used by products." })?.detail).toBe(
      "Used by products.",
    );
  });

  it("returns undefined for other database errors and for non-database errors", () => {
    expect(mapPostgresError(pgError("22021"))).toBeUndefined();
    expect(mapPostgresError(new Error("boom"))).toBeUndefined();
    expect(mapPostgresError("text")).toBeUndefined();
    expect(mapPostgresError(undefined)).toBeUndefined();
  });

  it("translatePostgresError rethrows the original error when nothing maps", () => {
    const original = new Error("boom");
    expect(translatePostgresError(original)).toBe(original);
    expect(translatePostgresError(pgError("23505", "brand_slug_key"))).toBeInstanceOf(
      ProblemException,
    );
  });

  it("finds the driver error through nested causes but not through unrelated errors", () => {
    expect(findPostgresError(wrapped(wrapped(pgError("23505", "x"))))).toEqual({
      code: "23505",
      constraint: "x",
    });
    expect(findPostgresError(new Error("a", { cause: new Error("b") }))).toBeUndefined();
  });

  it("isUniqueViolation can be limited to one constraint", () => {
    const error = wrapped(pgError("23505", "brand_slug_key"));
    expect(isUniqueViolation(error)).toBe(true);
    expect(isUniqueViolation(error, "brand_slug_key")).toBe(true);
    expect(isUniqueViolation(error, "product_slug_key")).toBe(false);
    expect(isUniqueViolation(pgError("23503", "brand_slug_key"))).toBe(false);
  });

  it("knows every unique constraint and primary key declared in the Drizzle schema", () => {
    let checked = 0;
    for (const value of Object.values(schema)) {
      if (!is(value, PgTable)) continue;
      const config = getTableConfig(value);
      const names = [
        ...config.uniqueConstraints.map((constraint) => constraint.getName()),
        ...config.primaryKeys.map((key) => key.getName()),
      ];
      for (const name of names) {
        expect(mapPostgresError(pgError("23505", name))).toMatchObject({
          code: "conflict",
          extensions: { constraint: name },
        });
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("gives a field hint for every single-column unique constraint of the schema", () => {
    for (const value of Object.values(schema)) {
      if (!is(value, PgTable)) continue;
      for (const constraint of getTableConfig(value).uniqueConstraints) {
        const name = constraint.getName();
        if (name === undefined || constraint.columns.length !== 1) continue;
        expect(mapPostgresError(pgError("23505", name))?.extensions.field, name).toBeTypeOf(
          "string",
        );
      }
    }
  });
});
