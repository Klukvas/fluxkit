import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EmailWorld } from "../../test/email-world.js";
import { EmailAdminRepository } from "./email-admin.repository.js";
import { providerUsage } from "./email-usage.js";

describe("retained email usage (real Postgres)", () => {
  let world: EmailWorld;
  const repository = new EmailAdminRepository();
  const asOf = new Date("2028-03-31T12:00:00.000Z");

  beforeAll(async () => {
    world = await EmailWorld.start();
  });
  beforeEach(async () => {
    await world.clear();
    world.clock.set(asOf);
  });
  afterAll(async () => {
    await world.stop();
  });

  async function accepted(
    code: string,
    time: string,
    attempts = 1,
    resendOf: string | null = null,
  ) {
    const id = await world.enqueued();
    await world.pool.query(
      "update email_message set status = 'sent', attempts = $2, provider_code = $3, provider_message_id = 'pm_test', sent_at = $4, updated_at = $5, resend_of = $6 where id = $1",
      [id, attempts, code, new Date(time), new Date("2028-04-01T00:00:00Z"), resendOf],
    );
    return id;
  }

  it("counts each accepted row once by actual provider/sent_at, with exclusive asOf and UTC boundaries", async () => {
    const original = await accepted("resend", "2028-03-01T00:00:00.000Z", 7);
    await accepted("resend", "2028-03-31T00:00:00.000Z", 1, original);
    await accepted("resend", "2028-03-31T11:59:59.999Z");
    await accepted("resend", "2028-03-31T12:00:00.000Z");
    await accepted("resend", "2028-02-29T23:59:59.999Z");
    await accepted("brevo", "2028-03-31T10:00:00.000Z");
    for (const status of ["pending", "sending", "unknown", "cancelled"] as const) {
      const id = await world.enqueued();
      await world.pool.query(
        "update email_message set status = $2, attempts = 3, provider_code = 'resend', pinned_provider_code = 'resend', pinned_at = $3, lease_until = $3, last_error_code = 'unavailable' where id = $1",
        [id, status, asOf],
      );
    }
    expect(await repository.usage(world.database, "resend", asOf)).toEqual({
      daily: 2,
      monthly: 3,
    });
    expect(await repository.usage(world.database, "brevo", asOf)).toEqual({ daily: 1, monthly: 1 });
    expect(await repository.usage(world.database, "fake", asOf)).toEqual({ daily: 0, monthly: 0 });
  });

  it("does not reset provider history after an account cutover; cleanup can lower the retained count", async () => {
    const beforeChange = await accepted("resend", "2028-03-31T08:00:00.000Z");
    await accepted("resend", "2028-03-31T11:00:00.000Z");
    const counts = await repository.usage(world.database, "resend", asOf);
    expect(
      providerUsage("resend", asOf, counts, { resend: { daily: 1, monthly: 1 } }),
    ).toMatchObject({
      daily: { accepted: 2, warning: "limit_reached" },
      lowerBound: true,
      countScope: "provider_all_accounts",
      credentialHistory: "unknown",
      credentialChangedAt: null,
    });
    await world.pool.query("delete from email_message where id = $1", [beforeChange]);
    expect(await repository.usage(world.database, "resend", asOf)).toEqual({
      daily: 1,
      monthly: 1,
    });
  });

  it("keeps provider counts in one repeatable-read snapshot while another connection records an acceptance", async () => {
    await accepted("resend", "2028-03-31T10:00:00.000Z");
    await world.database.transaction(
      async (tx) => {
        expect(await repository.usage(tx, "resend", asOf)).toEqual({ daily: 1, monthly: 1 });
        await accepted("brevo", "2028-03-31T11:00:00.000Z");
        expect(await repository.usage(tx, "brevo", asOf)).toEqual({ daily: 0, monthly: 0 });
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
    expect(await repository.usage(world.database, "brevo", asOf)).toEqual({ daily: 1, monthly: 1 });
  });
  it("uses the provider/time index for representative retained history without changing planner settings", async () => {
    const seed = await accepted("resend", "2028-03-31T10:00:00.000Z");
    await world.pool.query(
      `
      insert into email_message (id, template_key, template_version, locale, to_address, recipient_kind, variables,
        status, attempts, next_attempt_at, deadline_at, provider_code, provider_message_id, created_at, sent_at, updated_at)
      select gen_random_uuid(), template_key, template_version, locale, to_address, recipient_kind, variables,
        status, attempts, next_attempt_at, deadline_at,
        case when ordinal % 2 = 0 then 'resend' else 'brevo' end, provider_message_id, created_at,
        '2027-01-01T00:00:00Z'::timestamptz + ordinal * interval '1 minute', updated_at
      from email_message cross join generate_series(1, 20000) as ordinal where id = $1
    `,
      [seed],
    );
    await world.pool.query("analyze email_message");
    const explained = await world.pool.query<{ "QUERY PLAN": string }>(
      `
      explain (analyze, buffers)
      select count(*)::text, count(*) filter (where sent_at >= $3::timestamptz)::text
      from email_message where status = 'sent' and provider_code = $1
        and sent_at >= $2::timestamptz and sent_at < $4::timestamptz
    `,
      ["resend", "2028-03-01T00:00:00Z", "2028-03-31T00:00:00Z", asOf.toISOString()],
    );
    const plan = explained.rows.map((row) => row["QUERY PLAN"]).join("\n");
    expect(plan).toMatch(
      /(?:Index Only Scan|Index Scan|Bitmap Index Scan).*email_message_provider_sent_at_idx/,
    );
    expect(plan).toContain("Buffers:");
    expect(plan).not.toContain("Seq Scan on email_message");
  });
});
