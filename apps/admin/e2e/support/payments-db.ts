// Payment rows for the admin e2e scenarios that need MANY or UNUSUAL attempts, written straight into the e2e database.
//
// The payment flow itself is NOT seeded any more (payments plan step 11): `tests/payments.e2e.ts` settles payments through the
// store API and the fake provider's signed webhook (`support/fake-provider.ts`). A row is inserted here only where a provider
// would take many steps for little value: an attention item on an order that is paid another way (`duplicate_payment`) and 22
// attention items for the keyset paging of the list. The rows are `fake` attempts that the fake provider does not hold, so a
// refund or a status check on them would fail with `not_found`; the scenarios that use them only list, open and close them.
// No test-only route exists in the API; this runs in the database the run owns and wipes.
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
