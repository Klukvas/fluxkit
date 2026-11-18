import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { withTransaction } from "../../common/transaction.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";

export type EmailRouteMode = "equal" | "resend";

/** The only pair the admin route shares. Anything else keeps its own order. */
export const EMAIL_ROUTE_PAIR = ["resend", "brevo"] as const;

/** Odd turns start with Resend, even turns with Brevo, so a fresh counter shares the first hundred 50/50. */
export function assignedProvider(turn: number): "resend" | "brevo" {
  return turn % 2 === 1 ? "resend" : "brevo";
}

/** True when both Resend and Brevo are in this send chain, stored or set on the server. */
export function isEmailRoutePair(codes: readonly string[]): boolean {
  return EMAIL_ROUTE_PAIR.every((code) => codes.includes(code));
}

/** The stored mode. A missing row or any other value is a broken setting, not a silent `equal`. */
export function parseEmailRouteMode(mode: string | undefined): EmailRouteMode {
  if (mode === "equal" || mode === "resend") return mode;
  throw new Error("email_route_mode_invalid");
}

/** Reads the singleton. Callers that send and the admin list share this query. */
export async function readEmailRouteMode(db: Database): Promise<EmailRouteMode> {
  const rows = await db.execute<{ mode: string }>(
    sql`select mode from email_route_setting where id = 1`,
  );
  return parseEmailRouteMode(rows.rows[0]?.mode);
}

/**
 * Puts the assigned provider first and keeps the other as the fallback. No assignment leaves the chain as it is.
 * An assignment that is not in the chain is a bug: the message must not leave through someone else.
 */
export function orderEmailProviders<T extends { readonly code: string }>(
  chain: readonly T[],
  assigned: string | null,
): readonly T[] {
  if (assigned === null) return chain;
  const index = chain.findIndex((item) => item.code === assigned);
  if (index < 0) throw new Error("email_route_assignment_unknown");
  if (index === 0) return chain;
  const chosen = chain[index];
  if (chosen === undefined) throw new Error("email_route_assignment_unknown");
  return [chosen, ...chain.slice(0, index), ...chain.slice(index + 1)];
}

/**
 * How Resend and Brevo share mail when both are in the send chain. `resend` keeps Resend first. `equal` remembers
 * one starting provider per message and does not take another turn on a retry. A set `EMAIL_PROVIDER` does not
 * hide this: a chain that contains only one of the two cannot be shared, and a chain that contains both follows
 * the stored mode.
 */
@Injectable()
export class EmailRoutePolicy {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  mode(): Promise<EmailRouteMode> {
    return readEmailRouteMode(this.db);
  }

  /** The provider this message already started with, or a newly taken turn. Null when the row is gone. */
  async assign(messageId: string): Promise<"resend" | "brevo" | null> {
    return withTransaction(this.db, async (tx) => {
      const existing = await tx.execute<{ assigned_provider_code: string | null }>(sql`
        select assigned_provider_code from email_message
        where id = ${messageId}::uuid
        for update`);
      const row = existing.rows[0];
      if (row === undefined) return null;
      if (row.assigned_provider_code === "resend" || row.assigned_provider_code === "brevo") {
        return row.assigned_provider_code;
      }
      const bumped = await tx.execute<{ turn: string | number }>(sql`
        update email_route_setting set turn = turn + 1 where id = 1 returning turn`);
      const turn = Number(bumped.rows[0]?.turn);
      if (!Number.isSafeInteger(turn) || turn < 1) {
        throw new Error("email_route_turn_invalid");
      }
      const assigned = assignedProvider(turn);
      const written = await tx.execute(sql`
        update email_message set assigned_provider_code = ${assigned}
        where id = ${messageId}::uuid and assigned_provider_code is null`);
      if (written.rowCount !== 1) throw new Error("email_route_assignment_missing");
      return assigned;
    });
  }
}
