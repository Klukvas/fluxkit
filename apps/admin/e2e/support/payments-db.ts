// Payment rows for the admin e2e scenarios, written straight into the e2e database.
//
// Why not through the API: the suite's API runs with `PAYMENT_PROVIDERS_ENABLED=""` (no provider), and the only provider that
// can pay without a bank is the in-process `fake` (`packages/providers/_fake-payment`), whose test hooks cannot cross the
// process boundary to this browser suite (its README: an HTTP or file bridge arrives with plan step 11). A test-only route in
// the production API is not an option, so the rows a paying shopper would have made are inserted here, in the database the
// run owns and wipes. What the SCREENS and the admin ROUTES do with them (reads, refunds, clearing an attention item) is real.
// Nothing here talks to a payment provider, and a provider is not loaded, so a refund is recorded but never delivered.
//
// `pg` is the API's own dependency, resolved from `apps/api` (as `prepare-database.ts` does), so the admin package adds nothing.
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { requireE2eDatabaseUrl } from "./env.ts";

interface Client {
  connect(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

const apiRoot = resolve(import.meta.dirname, "../../../api");
const { Client } = createRequire(resolve(apiRoot, "package.json"))("pg") as {
  Client: new (options: { connectionString: string }) => Client;
};

async function withDatabase<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: requireE2eDatabaseUrl() });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export interface SeededPayment {
  orderId: string;
  /** Unique per payment (the provider id is unique per provider). */
  providerPaymentId: string;
  amount: number;
  currency?: string;
  /** An open attention item with this code; `null` for none. */
  attentionCode?:
    | "late_payment"
    | "duplicate_payment"
    | "amount_mismatch"
    | "refund_failed"
    | "reconcile_gave_up"
    | null;
  /** Minutes before now that the attempt was created (newest first ordering in the attention list). */
  createdMinutesAgo?: number;
}

/** A `succeeded` attempt of provider code `fake` paid by a guest with a Visa ending 4242, with a journal row. Answers its id. */
export async function seedSucceededPayment(payment: SeededPayment): Promise<string> {
  const id = randomUUID();
  const attention = payment.attentionCode ?? null;
  await withDatabase(async (client) => {
    await client.query(
      `insert into payment (
         id, order_id, provider_code, provider_payment_id, amount, currency, status, provider_status,
         provider_modified_at, final_amount, order_outcome, needs_attention, attention_code, card_system, card_last4,
         created_by, idempotency_key, expires_at, created_at, updated_at
       ) values (
         $1, $2, 'fake', $3, $4, $5, 'succeeded', 'success',
         now(), $4, $6, $7, $8, 'visa', '4242',
         'guest', $9, now() + interval '1 hour', now() - make_interval(mins => $10), now()
       )`,
      [
        id,
        payment.orderId,
        payment.providerPaymentId,
        payment.amount,
        payment.currency ?? "UAH",
        attention === "duplicate_payment" ? "reference_conflict" : "applied",
        attention !== null,
        attention,
        randomUUID(),
        payment.createdMinutesAgo ?? 0,
      ],
    );
    await client.query(
      `insert into payment_event (payment_id, source, applied, from_status, to_status)
       values ($1, 'system', true, 'processing', 'succeeded')`,
      [id],
    );
  });
  return id;
}
