import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireTestDatabaseUrl } from "../test/env.js";
import { ensureMigrated } from "../test/migrate.js";

const RESTRICT_VIOLATION = "23001";

/**
 * Every table whose rows are append-only or immutable (a row-level BEFORE UPDATE OR DELETE trigger of migrations 0003,
 * 0004, 0006, 0008 and 0009; ADR 0012, 0019, 0033). A row trigger does not fire for TRUNCATE, so migration 0011 adds a
 * statement-level BEFORE TRUNCATE trigger to each.
 */
const APPEND_ONLY_TABLES = [
  "admin_audit_event",
  "order_adjustment",
  "order_item",
  "order_shipping",
  "order_status_change",
  "payment_event",
  "shipment_status_change",
  "stock_movement",
] as const;

describe("migration 0011 (real Postgres): TRUNCATE refused on append-only tables, payment list indexes", () => {
  // Destructive statements run inside a transaction that is always rolled back: if a trigger were missing, the
  // TRUNCATE would be undone instead of emptying a table other specs use.
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await pool.end();
  });

  async function inRolledBackTransaction(statement: string): Promise<unknown> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      // Fail fast instead of waiting behind another spec's row locks.
      await client.query("set local lock_timeout = '10s'");
      try {
        await client.query(statement);
        return undefined;
      } catch (error) {
        return error;
      } finally {
        await client.query("rollback");
      }
    } finally {
      client.release();
    }
  }

  describe("TRUNCATE protection", () => {
    it.each(APPEND_ONLY_TABLES)(
      "refuses TRUNCATE %s CASCADE with restrict_violation",
      async (table) => {
        // CASCADE, because a plain TRUNCATE of a referenced table (order_item) is already refused by the foreign key
        // check, before any trigger fires; CASCADE is the statement that would otherwise empty the journal.
        const error = await inRolledBackTransaction(`truncate table "${table}" cascade`);
        expect(error).toMatchObject({
          code: RESTRICT_VIOLATION,
          message: expect.stringMatching(/^[a-z_]+ is append-only: TRUNCATE is not allowed$/),
        });
      },
    );

    it("names the table in the refusal of a plain TRUNCATE", async () => {
      expect(await inRolledBackTransaction('truncate table "admin_audit_event"')).toMatchObject({
        code: RESTRICT_VIOLATION,
        message: "admin_audit_event is append-only: TRUNCATE is not allowed",
      });
    });

    it("refuses a TRUNCATE that reaches an append-only table through CASCADE", async () => {
      // sales_order itself is mutable, but CASCADE truncates order_item, order_status_change and the others with it.
      expect(await inRolledBackTransaction('truncate table "sales_order" cascade')).toMatchObject({
        code: RESTRICT_VIOLATION,
      });
      expect(await inRolledBackTransaction('truncate table "payment" cascade')).toMatchObject({
        code: RESTRICT_VIOLATION,
        message: "payment_event is append-only: TRUNCATE is not allowed",
      });
    });

    it("still lets a table that is not append-only be truncated (the trigger is not global)", async () => {
      // Created, filled and truncated inside the rolled-back transaction.
      expect(
        await inRolledBackTransaction(
          'create table "truncate_probe_0011" (id int primary key); insert into "truncate_probe_0011" values (1); truncate table "truncate_probe_0011"',
        ),
      ).toBe(undefined);
      // A mutable table of the schema stays truncatable: the domain_event outbox.
      expect(await inRolledBackTransaction('truncate table "domain_event"')).toBe(undefined);
    });

    it("has an enabled statement-level BEFORE TRUNCATE trigger on every table with a row-level append-only trigger", async () => {
      const rowLevel = await pool.query<{ table: string }>(
        `select distinct c.relname as "table"
         from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
         join pg_namespace n on n.oid = c.relnamespace
         where not t.tgisinternal and n.nspname = 'public'
           and (p.proname like '%\\_append\\_only' or p.proname like '%\\_immutable')
         order by 1`,
      );
      expect(rowLevel.rows.map((row) => row.table)).toEqual([...APPEND_ONLY_TABLES]);

      const truncate = await pool.query<{
        table: string;
        name: string;
        definition: string;
        enabled: string;
      }>(
        `select c.relname as "table", t.tgname as name, pg_get_triggerdef(t.oid) as definition,
                t.tgenabled as enabled
         from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
         where not t.tgisinternal and n.nspname = 'public' and (t.tgtype & 32) <> 0
         order by 1`,
      );
      expect(truncate.rows.map((row) => row.table)).toEqual([...APPEND_ONLY_TABLES]);
      for (const row of truncate.rows) {
        expect(row.name).toBe(`${row.table}_no_truncate`);
        expect(row.definition).toBe(
          `CREATE TRIGGER ${row.table}_no_truncate BEFORE TRUNCATE ON public.${row.table} FOR EACH STATEMENT EXECUTE FUNCTION append_only_refuse_truncate()`,
        );
        // 'O': fires in the default session_replication_role ("origin"), the one the application uses.
        expect(row.enabled).toBe("O");
      }
    });
  });

  describe("payment list indexes", () => {
    it("indexes the attention list and the unfiltered list in the order of the query (DESC NULLS FIRST)", async () => {
      const result = await pool.query<{ name: string; definition: string }>(
        `select indexname as name, indexdef as definition from pg_indexes
         where schemaname = 'public' and tablename = 'payment'
           and indexname in ('payment_attention_created_at_id_idx', 'payment_created_at_id_idx')
         order by 1`,
      );
      expect(result.rows).toEqual([
        {
          name: "payment_attention_created_at_id_idx",
          definition:
            "CREATE INDEX payment_attention_created_at_id_idx ON public.payment USING btree (created_at DESC, id DESC) WHERE needs_attention",
        },
        {
          name: "payment_created_at_id_idx",
          definition:
            "CREATE INDEX payment_created_at_id_idx ON public.payment USING btree (created_at DESC, id DESC)",
        },
      ]);
    });
  });
});
