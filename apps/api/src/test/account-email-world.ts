import pg from "pg";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { EmailProviderRegistry } from "../email/registry/index.js";
import {
  startApp,
  TEST_STOREFRONT_PUBLIC_URL,
  type RunningApp,
  type StartAppOptions,
} from "./app.js";
import { createTestCustomer, deleteTestCustomers, type TestCustomer } from "./customer-fixtures.js";
import { FakeClock } from "./fake-clock.js";
import { http, type HttpOptions, type HttpResult } from "./http.js";
import { requireTestDatabaseUrl } from "./env.js";
import { ensureMigrated } from "./migrate.js";
import {
  testEmailProviders,
  type TestEmailProvider,
  type TestSentEmail,
} from "./test-email-provider.js";

/** A mail the test provider accepted, with the link and token of its plain-text part. */
export interface CapturedAuthMail {
  readonly mail: TestSentEmail;
  /** The action link as the text part prints it, `undefined` when it has none. */
  readonly link: string | undefined;
  /** The `#t=` fragment of the link. */
  readonly token: string | undefined;
  /** The locale segment of the link. */
  readonly locale: string | undefined;
}

export interface AuthTokenDbRow {
  id: string;
  customer_id: string;
  purpose: string;
  token_hash: string;
  email: string;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
}

export const ACCOUNT_PASSWORD = "correct horse battery staple";
export const NEW_PASSWORD = "a brand new long passphrase";

const LINK =
  /(https?:\/\/[^\s]+\/([a-z-]+)\/account\/(?:reset-password|verify-email)#t=([A-Za-z0-9_-]+))/;

/**
 * TEST ONLY. An API with the in-repo test email provider (deliveries are captured in memory, nothing leaves the process),
 * a fake clock for token expiry and the rate limit windows, plus a pool for row reads. `between()` moves the clock past
 * every window and empties the outbox and the mailbox.
 */
export class AccountEmailWorld {
  readonly pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  readonly customers: string[] = [];

  private constructor(
    readonly clock: FakeClock,
    readonly running: RunningApp,
  ) {}

  static async start(options: StartAppOptions = {}): Promise<AccountEmailWorld> {
    await ensureMigrated();
    const clock = new FakeClock(new Date("2031-04-01T09:00:00.000Z"));
    const running = await startApp({
      clock,
      extraEmailProviders: testEmailProviders(),
      ...options,
      emailDeliveryTuning: {
        sendTimeoutMs: 500,
        sendsPerSecond: 1_000,
        ...options.emailDeliveryTuning,
      },
    });
    return new AccountEmailWorld(clock, running);
  }

  get baseUrl(): string {
    return this.running.baseUrl;
  }

  get db(): Database {
    return this.running.app.get<Database>(DRIZZLE);
  }

  get provider(): TestEmailProvider {
    return this.running.app.get(EmailProviderRegistry).get() as TestEmailProvider;
  }

  async customer(
    options: { isActive?: boolean; email?: string } = {},
  ): Promise<TestCustomer & { password: string }> {
    const created = await createTestCustomer(this.db, { ...options, password: ACCOUNT_PASSWORD });
    this.customers.push(created.id);
    return { ...created, password: ACCOUNT_PASSWORD };
  }

  post<T = Record<string, unknown>>(
    path: string,
    body?: unknown,
    options: HttpOptions = {},
  ): Promise<HttpResult<T>> {
    return http<T>(this.baseUrl, "POST", path, {
      ...(body === undefined ? {} : { body }),
      ...options,
    });
  }

  requestReset(email: string, locale = "en", options: HttpOptions = {}): Promise<HttpResult> {
    return this.post("/store/account/password-reset", { email, locale }, options);
  }

  confirmReset(token: string, newPassword = NEW_PASSWORD): Promise<HttpResult> {
    return this.post("/store/account/password-reset/confirm", { token, newPassword });
  }

  verify(token: string): Promise<HttpResult> {
    return this.post("/store/account/verify-email", { token });
  }

  /** The mails accepted for `to`, oldest first. */
  mailsTo(to: string): CapturedAuthMail[] {
    return this.provider.sent
      .filter((sent) => sent.message.to.address === to)
      .map((mail) => {
        const match = LINK.exec(mail.message.text);
        return {
          mail,
          link: match?.[1],
          locale: match?.[2],
          token: match?.[3],
        };
      });
  }

  /** Waits (real time) until `count` mails for `to` were accepted: the immediate attempt is fire and forget. */
  async waitForMails(to: string, count = 1, timeoutMs = 4_000): Promise<CapturedAuthMail[]> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const mails = this.mailsTo(to);
      if (mails.length >= count) {
        return mails;
      }
      if (Date.now() > deadline) {
        throw new Error(`Expected ${String(count)} mails, got ${String(mails.length)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  /** The newest mail for `to` (waiting for it), which must carry a token. */
  async tokenMailTo(to: string, count = 1): Promise<CapturedAuthMail & { token: string }> {
    const mails = await this.waitForMails(to, count);
    const mail = mails[mails.length - 1];
    if (mail?.token === undefined) {
      throw new Error("The mail carries no token link");
    }
    return { ...mail, token: mail.token };
  }

  async tokenRows(customerId: string): Promise<AuthTokenDbRow[]> {
    const result = await this.pool.query<AuthTokenDbRow>(
      "select * from customer_auth_token where customer_id = $1 order by created_at, id",
      [customerId],
    );
    return result.rows;
  }

  async outboxRows(customerId: string): Promise<Record<string, unknown>[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      "select * from email_message where customer_id = $1 order by created_at, id",
      [customerId],
    );
    return result.rows;
  }

  async customerRow(id: string): Promise<Record<string, unknown>> {
    const result = await this.pool.query<Record<string, unknown>>(
      "select * from customer where id = $1",
      [id],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error(`No customer ${id}`);
    }
    return row;
  }

  /** Moves the clock past every rate limit window and the hourly token count; empties the outbox and the mailbox. */
  async between(): Promise<void> {
    this.clock.advanceMinutes(121);
    await deleteTestCustomers(this.db, this.customers.splice(0));
    await this.pool.query("delete from email_message");
    this.provider.reset();
  }

  async stop(): Promise<void> {
    await deleteTestCustomers(this.db, this.customers.splice(0));
    await this.pool.query("delete from email_message");
    await this.running.app.close();
    await this.pool.end();
  }
}

/** The storefront origin every link must start with (never a request's `Host`). */
export const LINK_ORIGIN = TEST_STOREFRONT_PUBLIC_URL;
