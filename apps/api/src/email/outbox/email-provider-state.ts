import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { EMAIL_LEASE_SECONDS, nextEmailAttempt, type EmailProviderFailure } from "@fluxkit/core";
import type { Transaction } from "../../common/transaction.js";

export const SAFE_FALLBACK_REASONS = [
  "quota_exceeded",
  "rate_limited",
  "misconfigured",
  "not_sent",
] as const;
export const COOLDOWN_REASONS = ["quota_exceeded", "rate_limited", "misconfigured"] as const;
// Longer than the complete claim lifetime: pacing and the provider timeout are already fenced inside that lease.
const PROBE_LEASE_SECONDS = EMAIL_LEASE_SECONDS + 30;

export interface ProviderAdmission {
  readonly allowed: boolean;
  readonly probeToken?: string;
  /** Relative to DB time, mapped to the message clock by the caller. */
  readonly waitMs: number;
}

/** The row lock serializes recovery admission across API instances; no transaction survives a provider call. */
export async function admitEmailProvider(
  tx: Transaction,
  code: string,
): Promise<ProviderAdmission> {
  const state = await tx.execute<{
    unavailable_until: Date | string;
    probe_until: Date | string | null;
    db_now: Date | string;
  }>(sql`select unavailable_until, probe_until, clock_timestamp() as db_now
    from email_provider_state where provider_code = ${code} for update`);
  const row = state.rows[0];
  if (row === undefined) return { allowed: true, waitMs: 0 };
  const now = new Date(row.db_now).getTime();
  const blockedUntil = Math.max(
    new Date(row.unavailable_until).getTime(),
    row.probe_until === null ? 0 : new Date(row.probe_until).getTime(),
  );
  if (blockedUntil > now) return { allowed: false, waitMs: blockedUntil - now };
  const probeToken = randomUUID();
  await tx.execute(sql`update email_provider_state set probe_token = ${probeToken}::uuid,
    probe_until = clock_timestamp() + ${PROBE_LEASE_SECONDS} * interval '1 second', updated_at = clock_timestamp()
    where provider_code = ${code}`);
  return { allowed: true, waitMs: 0, probeToken };
}

/** Only a matching successful recovery probe may clear a block. A concurrent newer refusal invalidates its token. */
export async function clearEmailProviderProbe(
  tx: Transaction,
  code: string,
  token?: string,
): Promise<void> {
  if (token === undefined) return;
  await tx.execute(
    sql`delete from email_provider_state where provider_code = ${code} and probe_token = ${token}::uuid`,
  );
}

/** Provider results, never advisory usage counts, create shared cooldowns. */
export async function recordEmailProviderCooldown(
  tx: Transaction,
  code: string,
  failureInput: EmailProviderFailure,
  attempts: number,
): Promise<void> {
  if (!COOLDOWN_REASONS.some((reason) => reason === failureInput.reason)) return;
  const time = await tx.execute<{ now: string | Date }>(sql`select clock_timestamp() as now`);
  const rawNow = time.rows[0]?.now;
  if (rawNow === undefined) throw new Error("email_provider_clock_missing");
  const now = new Date(rawNow);
  const until = emailProviderCooldownAt(code, failureInput, attempts, now);
  await tx.execute(sql`insert into email_provider_state (provider_code, unavailable_until, reason, updated_at)
    values (${code}, ${until.toISOString()}::timestamptz, ${failureInput.reason}, clock_timestamp())
    on conflict (provider_code) do update set unavailable_until = greatest(email_provider_state.unavailable_until, excluded.unavailable_until),
      reason = excluded.reason, probe_token = null, probe_until = null, updated_at = clock_timestamp()`);
}

/** Earliest usable provider on a new pass; a provider without a block waits the message's ordinary backoff. */
export async function emailChainWaitMs(
  tx: Transaction,
  codes: readonly string[],
  backoffMs: number,
  messageRetry?: { readonly providerCode: string; readonly waitMs: number },
): Promise<number> {
  const states = await tx.execute<{ provider_code: string; wait_ms: string | number }>(sql`
    select provider_code, greatest(1000, extract(epoch from
      (greatest(unavailable_until, coalesce(probe_until, unavailable_until)) - clock_timestamp())) * 1000) as wait_ms
    from email_provider_state where provider_code in (${sql.join(
      codes.map((code) => sql`${code}`),
      sql`, `,
    )})`);
  const byCode = new Map(states.rows.map((row) => [row.provider_code, Number(row.wait_ms)]));
  return Math.max(
    1_000,
    Math.min(
      ...codes.map((code) =>
        Math.max(
          byCode.get(code) ?? backoffMs,
          // A message-specific refusal must survive even an expired shared cooldown or recovery probe.
          code === messageRetry?.providerCode ? messageRetry.waitMs : 0,
        ),
      ),
    ),
  );
}

/** Bounded provider-specific reset policy, independent of the host time zone. */
export function emailProviderCooldownAt(
  code: string,
  failureInput: EmailProviderFailure,
  attempts: number,
  now: Date,
): Date {
  // TODO(fluxkit): not live-verified. Only Resend establishes the UTC daily reset; never infer one for Brevo.
  const failure = code === "resend" ? failureInput : { ...failureInput, quotaPeriod: undefined };
  // Cooldown outlives this mail: adapters can validate Retry-After values up to 31 days.
  // Give the pure scheduler a horizon beyond the delay/reset, bounded only by Date's representable range.
  const retryMs = (failure.retryAfterSeconds ?? 0) * 1_000;
  const horizon = Math.min(
    8_640_000_000_000_000,
    now.getTime() + Math.max(retryMs, 2 * 86_400_000) + 86_400_000,
  );
  const decision = nextEmailAttempt({
    attempts,
    failure,
    now,
    deadlineAt: new Date(horizon),
  });
  if (decision.status !== "pending") throw new Error("email_provider_cooldown_invalid");
  return decision.nextAttemptAt;
}
