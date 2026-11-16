// Provider feedback is covered by API integration tests. This UI fixture creates only one block in the disposable
// e2e database; it does not call a live provider or add a test-only API route. `pg` is the API's existing dependency.
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { requireE2eDatabaseUrl } from "./env.ts";

interface Client {
  connect(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<unknown>;
  end(): Promise<void>;
}

const apiRoot = resolve(import.meta.dirname, "../../../api");
const { Client } = createRequire(resolve(apiRoot, "package.json"))("pg") as {
  Client: new (options: { connectionString: string }) => Client;
};

/** One reserved-domain address, independent of any real customer or mail provider. */
export async function seedEmailSuppression(address: string): Promise<string> {
  if (!/^[a-z0-9-]+@example\.test$/.test(address))
    throw new Error("Invalid e2e suppression address");
  const id = randomUUID();
  const client = new Client({ connectionString: requireE2eDatabaseUrl() });
  await client.connect();
  try {
    await client.query(
      `insert into email_suppression (id, to_address, reason, source_provider, first_seen_at, last_seen_at)
       values ($1, $2, 'complaint', 'resend', '2026-11-15T10:00:00Z', '2026-11-16T11:00:00Z')`,
      [id, address],
    );
  } finally {
    await client.end();
  }
  return id;
}
