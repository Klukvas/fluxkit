import pg from "pg";
import { withTransaction } from "../common/transaction.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import {
  EmailMessageChanges,
  EmailOutbox,
  EmailOutboxRepository,
  EmailSender,
  type EnqueueEmailInput,
  type EnqueueEmailResult,
} from "../email/outbox/index.js";
import { EmailProviderRegistry } from "../email/registry/index.js";
import { startApp, type RunningApp, type StartAppOptions } from "./app.js";
import { requireTestDatabaseUrl } from "./env.js";
import { FakeClock } from "./fake-clock.js";
import { ensureMigrated } from "./migrate.js";
import { testEmailProviders, type TestEmailProvider } from "./test-email-provider.js";

/** One `email_message` row as Postgres holds it (the columns the specs look at). */
export interface EmailRow {
  id: string;
  template_key: string;
  template_version: number;
  locale: string;
  to_address: string;
  recipient_kind: string;
  variables: Record<string, unknown>;
  dedupe_key: string | null;
  status: string;
  attempts: number;
  next_attempt_at: Date;
  lease_until: Date | null;
  deadline_at: Date;
  provider_code: string | null;
  provider_message_id: string | null;
  last_error_code: string | null;
  created_at: Date;
  sent_at: Date | null;
  updated_at: Date;
}

export const TEST_RECIPIENT = "buyer@example.net";

/**
 * TEST ONLY. An API with the in-repo test email provider, a fake clock, a short send timeout and free pacing (unless a
 * spec asks for another), plus a pool for probes and row reads. Every spec file starts its own world; `clear()` empties
 * the outbox between tests.
 */
export class EmailWorld {
  readonly pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  readonly apps: RunningApp[] = [];

  private constructor(
    readonly clock: FakeClock,
    readonly running: RunningApp,
  ) {
    this.apps.push(running);
  }

  static async start(options: StartAppOptions = {}): Promise<EmailWorld> {
    await ensureMigrated();
    const clock = new FakeClock(new Date("2030-03-01T10:00:00.000Z"));
    const running = await startApp({
      clock,
      extraEmailProviders: testEmailProviders(),
      ...options,
      emailDeliveryTuning: {
        sendTimeoutMs: 300,
        sendsPerSecond: 1_000,
        ...options.emailDeliveryTuning,
      },
    });
    const world = new EmailWorld(clock, running);
    await world.clear();
    return world;
  }

  /** A second API process over the same database, with its own provider instance (multi-instance races). */
  async secondInstance(): Promise<RunningApp> {
    const running = await startApp({
      clock: this.clock,
      extraEmailProviders: testEmailProviders(),
      emailDeliveryTuning: { sendTimeoutMs: 300, sendsPerSecond: 1_000 },
    });
    this.apps.push(running);
    return running;
  }

  get<T>(type: abstract new (...args: never[]) => T, running: RunningApp = this.running): T {
    return running.app.get(type as never);
  }

  get database(): Database {
    return this.running.app.get<Database>(DRIZZLE);
  }

  get outbox(): EmailOutbox {
    return this.get(EmailOutbox);
  }

  get sender(): EmailSender {
    return this.get(EmailSender);
  }

  get changes(): EmailMessageChanges {
    return this.get(EmailMessageChanges);
  }

  get repository(): EmailOutboxRepository {
    return this.get(EmailOutboxRepository);
  }

  provider(running: RunningApp = this.running): TestEmailProvider {
    return running.app.get(EmailProviderRegistry).get() as TestEmailProvider;
  }

  /** Enqueues `admin.test` (or `overrides`) at the clock's time in its own transaction. */
  async enqueue(overrides: Partial<EnqueueEmailInput> = {}): Promise<EnqueueEmailResult> {
    return withTransaction(this.database, (tx) =>
      this.outbox.enqueue(tx, {
        templateKey: "admin.test",
        locale: "en",
        to: TEST_RECIPIENT,
        recipientKind: "admin",
        variables: { providerCode: "fake" },
        now: this.clock.now(),
        ...overrides,
      }),
    );
  }

  /** Enqueues and answers the id (the spec expects `enqueued`). */
  async enqueued(overrides: Partial<EnqueueEmailInput> = {}): Promise<string> {
    const result = await this.enqueue(overrides);
    if (result.status !== "enqueued") {
      throw new Error(`Test setup: expected an enqueued mail, got ${result.status}`);
    }
    return result.id;
  }

  async row(id: string): Promise<EmailRow> {
    const result = await this.pool.query<EmailRow>("select * from email_message where id = $1", [
      id,
    ]);
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error(`No email_message ${id}`);
    }
    return row;
  }

  async count(): Promise<number> {
    const result = await this.pool.query<{ count: number }>(
      "select count(*)::int as count from email_message",
    );
    return result.rows[0]?.count ?? 0;
  }

  /** One attempt on `id` at the clock's time, the way job 9 does it. */
  attempt(id: string, running: RunningApp = this.running) {
    return this.get(EmailSender, running).attempt(id, () => this.clock.now());
  }

  async clear(): Promise<void> {
    await this.pool.query("delete from email_message");
    for (const running of this.apps) {
      this.provider(running)?.reset();
    }
  }

  async stop(): Promise<void> {
    await this.pool.query("delete from email_message");
    for (const running of this.apps) {
      await running.app.close();
    }
    await this.pool.end();
  }
}
