import { sql } from "drizzle-orm";
import type { DbExecutor } from "../../common/transaction.js";

/** Serializes sender-profile edits with shipment prepare, including providers without an integration row. */
export async function lockShippingProfile(tx: DbExecutor, code: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`shipping-profile:${code}`}, 0))`,
  );
}
