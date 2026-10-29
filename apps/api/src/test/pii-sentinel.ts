import type pg from "pg";

/**
 * TEST ONLY. Sentinel personal data for the leak guard (ADR 0033 decision 12). A sentinel is a value no code path may copy
 * into a log, a domain event payload, an error code, a problem body or any column that the inventory does not classify as
 * personal. Every value contains the marker `sentinel`, which no fixture or message uses otherwise.
 */
export interface SentinelSubject {
  readonly email: string;
  readonly phone: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly addressLine: string;
  /** Every value above, plus the phone without its plus sign, so a normalised copy is found too. */
  readonly values: readonly string[];
}

export function sentinelSubject(n: number, runId: string): SentinelSubject {
  const email = `pii-sentinel-${runId}-${n}@example.test`;
  const phone = `+38000000012${n}`;
  const firstName = `Sentinelfirst${runId}x${n}`;
  const lastName = `Sentinellast${runId}x${n}`;
  const addressLine = `Sentinel street ${runId} ${n}`;
  return {
    email,
    phone,
    firstName,
    lastName,
    addressLine,
    values: [email, phone, phone.slice(1), firstName, lastName, addressLine],
  };
}

/** The values (case-insensitive) that occur in the text. */
export function sentinelsIn(text: string, values: readonly string[]): string[] {
  const lower = text.toLowerCase();
  return values.filter((value) => lower.includes(value.toLowerCase()));
}

/** Columns whose name says they hold a stable machine code (never a message), found in the live database. */
export async function codeColumns(pool: pg.Pool): Promise<{ table: string; column: string }[]> {
  const result = await pool.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns
      where table_schema = 'public' and column_name ~ '(error_code|failure_code|attention_code)$'
      order by table_name, column_name`,
  );
  return result.rows.map((row) => ({ table: row.table_name, column: row.column_name }));
}

/**
 * Every row of `table.column` (cast to text) that contains one of the values. Table and column names come from the
 * inventory or the catalog above, never from input, and are quoted.
 */
export async function rowsContaining(
  pool: pg.Pool,
  table: string,
  columns: readonly string[],
  values: readonly string[],
): Promise<number> {
  if (columns.length === 0 || values.length === 0) return 0;
  const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
  const clauses: string[] = [];
  const params: string[] = [];
  for (const value of values) {
    params.push(`%${value.toLowerCase()}%`);
    const index = params.length;
    for (const column of columns) {
      clauses.push(`lower(${quote(table)}.${quote(column)}::text) like $${index}`);
    }
  }
  const result = await pool.query<{ count: string }>(
    `select count(*)::text as count from ${quote(table)} where ${clauses.join(" or ")}`,
    params,
  );
  return Number(result.rows[0]?.count ?? "0");
}
