import { Logger } from "@nestjs/common";
import pg from "pg";
import { DB_CONNECTION_TIMEOUT_MS } from "../database/database.module.js";

/**
 * First half of the two-integer advisory lock key of an event lease; the second half is `hashtext(event id)`. The
 * two-integer form is a different key space from the one-integer keys in use (7_426_001 to 7_426_003), so a lease can
 * never collide with the scheduler lock.
 */
export const EVENT_LEASE_CLASS = 7_426_004;

/** Shown in `pg_stat_activity`, so an operator (and a test) can tell the lease connection from the pool's and the scheduler lock's. */
export const EVENT_LEASE_APPLICATION_NAME = "fluxkit-event-lease";

/**
 * Makes the SERVER notice a dead client after about a minute (30 s idle + 3 probes 10 s apart) instead of after the
 * operating system default of two hours. A lease is a session advisory lock, so how fast the server drops a vanished
 * session is the visibility timeout of an event whose dispatcher died. These are per-session settings (userset).
 */
export const EVENT_LEASE_SESSION_OPTIONS =
  "-c tcp_keepalives_idle=30 -c tcp_keepalives_interval=10 -c tcp_keepalives_count=3";

/** One dispatcher's claims on events it is delivering right now. */
export interface EventLeases {
  /** Takes the lease of an event without waiting: `false` when another dispatcher (any instance) holds it. */
  tryAcquire(eventId: string): Promise<boolean>;
  release(eventId: string): Promise<void>;
  /** Ends the session: every lease still held goes with it. */
  close(): Promise<void>;
}

export interface EventLeaseSource {
  open(): Promise<EventLeases>;
}

/**
 * The lease of an event is a session level advisory lock on a DEDICATED connection (never the pool's, the same reason
 * as the scheduler lock, ADR 0021): it is held while a handler runs, when no transaction is open (ADR 0025), and the
 * server releases it when the dispatcher releases it, when the process dies, or when the connection is lost. The
 * dispatcher takes it before it claims an event, so two dispatchers never run the same event at the same time.
 */
export function pgEventLeaseSource(databaseUrl: string): EventLeaseSource {
  return {
    async open(): Promise<EventLeases> {
      const client = new pg.Client({
        connectionString: databaseUrl,
        connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS,
        application_name: EVENT_LEASE_APPLICATION_NAME,
        options: EVENT_LEASE_SESSION_OPTIONS,
        keepAlive: true,
      });
      // Without a listener a dropped connection would end the process. Only the code is logged (a message can embed
      // connection details); the leases are gone with the session and every handler is idempotent by event id.
      client.on("error", (error: Error & { code?: string }) => {
        new Logger("Scheduler").error(
          `Event lease connection error: ${error.name} code=${error.code ?? "none"}`,
        );
      });
      await client.connect();
      return {
        async tryAcquire(eventId: string): Promise<boolean> {
          const result = await client.query<{ locked: boolean }>(
            "select pg_try_advisory_lock($1::int, hashtext($2)) as locked",
            [EVENT_LEASE_CLASS, eventId],
          );
          return result.rows[0]?.locked === true;
        },
        async release(eventId: string): Promise<void> {
          await client.query("select pg_advisory_unlock($1::int, hashtext($2))", [
            EVENT_LEASE_CLASS,
            eventId,
          ]);
        },
        async close(): Promise<void> {
          await client.end();
        },
      };
    },
  };
}
