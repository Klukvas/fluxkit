import { is } from "drizzle-orm";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "../database/schema/index.js";
import {
  ProblemException,
  conflict,
  inUse,
  validationFailed,
  type ProblemExtensions,
} from "./problem.js";

/** SQLSTATE classes this module understands. Anything else stays an unexpected error (HTTP 500, logged). */
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";
/** `lock_not_available`: raised when a statement waited longer than `lock_timeout` for a lock. */
const LOCK_NOT_AVAILABLE = "55P03";

export interface PostgresErrorInfo {
  code: string;
  constraint: string | undefined;
}

/** Drizzle wraps driver errors in a `DrizzleQueryError` whose `cause` is the `pg` error: walk the chain. */
export function findPostgresError(error: unknown): PostgresErrorInfo | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth += 1) {
    if (current instanceof pg.DatabaseError) {
      return { code: current.code ?? "", constraint: current.constraint };
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return undefined;
}

function toCamelCase(snakeCase: string): string {
  return snakeCase.replace(/_([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());
}

function fieldOf(columns: readonly PgColumn[]): string | undefined {
  const [only] = columns;
  return columns.length === 1 && only !== undefined ? toCamelCase(only.name) : undefined;
}

/**
 * Unique constraint name -> API field, built from the Drizzle schema so that the names cannot drift from the
 * migrations. Only single-column constraints get a `field` hint; the `constraint` name is always reported.
 */
function buildUniqueFieldIndex(): ReadonlyMap<string, string | undefined> {
  const index = new Map<string, string | undefined>();
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) {
      continue;
    }
    const config = getTableConfig(value);
    for (const constraint of config.uniqueConstraints) {
      const name = constraint.getName();
      if (name !== undefined) {
        index.set(name, fieldOf(constraint.columns));
      }
    }
    for (const candidate of config.indexes) {
      if (candidate.config.unique && candidate.config.name !== undefined) {
        const columns = candidate.config.columns.filter(
          (column): column is PgColumn => "name" in column,
        );
        index.set(candidate.config.name, fieldOf(columns));
      }
    }
    for (const key of config.primaryKeys) {
      index.set(key.getName(), undefined);
    }
  }
  return index;
}

const uniqueFields = buildUniqueFieldIndex();

export interface PostgresErrorOptions {
  /**
   * What a foreign key violation (23503) means for the operation. Deleting a referenced row is `in_use`
   * (default). A write that points at a row that does not exist is a client error: use `invalid_reference`.
   * The SQLSTATE alone cannot tell the two apart and message text must not be parsed.
   */
  foreignKey?: "in_use" | "invalid_reference";
  /** Replaces the generic detail of the problem, e.g. "The brand is still used by products." */
  detail?: string;
}

/**
 * Maps a Postgres constraint violation to a problem by SQLSTATE and constraint name (never by message text).
 * Returns `undefined` for everything else, so the caller can rethrow the original error.
 */
export function mapPostgresError(
  error: unknown,
  options: PostgresErrorOptions = {},
): ProblemException | undefined {
  const info = findPostgresError(error);
  if (info === undefined) {
    return undefined;
  }
  const constraint = info.constraint;
  switch (info.code) {
    case UNIQUE_VIOLATION: {
      const field = constraint === undefined ? undefined : uniqueFields.get(constraint);
      return conflict(options.detail ?? "A record with the same unique value already exists.", {
        ...hint({ field, constraint }),
      });
    }
    case FOREIGN_KEY_VIOLATION:
      if (options.foreignKey === "invalid_reference") {
        return validationFailed(
          [{ path: "", code: "invalid_reference" }],
          options.detail ?? "The request refers to a record that does not exist.",
        );
      }
      return inUse(
        options.detail ?? "The record is still referenced by other records.",
        hint({ constraint }),
      );
    case CHECK_VIOLATION:
      // The service layer is meant to catch bad data first; reaching a CHECK means a validation gap, still a client error.
      return new ProblemException({
        code: "validation_failed",
        detail: options.detail ?? "A value violates a data rule.",
        errors: [{ path: "", code: "check_violation" }],
        extensions: hint({ constraint }),
      });
    default:
      return undefined;
  }
}

function hint(values: {
  field?: string | undefined;
  constraint?: string | undefined;
}): ProblemExtensions {
  return {
    ...(values.field === undefined ? {} : { field: values.field }),
    ...(values.constraint === undefined ? {} : { constraint: values.constraint }),
  };
}

/** `throw translatePostgresError(error)` in a catch block: a mapped problem, or the original error untouched. */
export function translatePostgresError(error: unknown, options?: PostgresErrorOptions): unknown {
  return mapPostgresError(error, options) ?? error;
}

/** True for a unique violation, optionally of one specific constraint (used by retry-on-collision loops). */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const info = findPostgresError(error);
  return (
    info !== undefined &&
    info.code === UNIQUE_VIOLATION &&
    (constraint === undefined || info.constraint === constraint)
  );
}

/** True when a statement gave up waiting for a lock (`lock_timeout`, or `NOWAIT`): SQLSTATE 55P03. */
export function isLockNotAvailable(error: unknown): boolean {
  return findPostgresError(error)?.code === LOCK_NOT_AVAILABLE;
}
