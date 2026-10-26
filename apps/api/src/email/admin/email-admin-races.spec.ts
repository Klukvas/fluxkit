import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ProblemBody } from "../../common/problem.filter.js";
import { EmailAdminWorld } from "../../test/email-admin-world.js";

interface Settled {
  status: number;
  body: unknown;
}

describe("admin email: cancel and resend against each other and against the sender (the single writer decides)", () => {
  let ctx: EmailAdminWorld;

  const world = () => ctx.world;

  beforeAll(async () => {
    ctx = await EmailAdminWorld.start();
  });

  beforeEach(async () => {
    world().clock.advanceMinutes(61);
    await world().clear();
    await ctx.signInAs("owner");
  });

  afterAll(async () => {
    await ctx.stop();
  });

  const cancel = (id: string): Promise<Settled> =>
    ctx.call("POST", `/admin/email/messages/${id}/cancel`);

  it("two cancels at once: exactly one wins, the other is a 409 invalid_transition", async () => {
    for (let round = 0; round < 8; round += 1) {
      const id = await world().enqueued();
      const results = await Promise.all([cancel(id), cancel(id), cancel(id)]);
      const statuses = results.map((result) => result.status).sort();
      expect(statuses, `round ${String(round)}`).toEqual([200, 409, 409]);
      for (const loser of results.filter((result) => result.status === 409)) {
        expect(loser.body).toMatchObject({ code: "invalid_transition" });
      }
      expect((await world().row(id)).status).toBe("cancelled");
    }
  });

  it("cancel against the claim of job 9: exactly one wins and the provider is called only when the claim won", async () => {
    let cancelled = 0;
    let sent = 0;
    for (let round = 0; round < 30; round += 1) {
      world().provider().reset();
      const id = await world().enqueued();
      const [cancelResult, attempt] = await Promise.all([cancel(id), world().attempt(id)]);
      const row = await world().row(id);
      if (cancelResult.status === 200) {
        cancelled += 1;
        // The cancel committed first: the claim found nothing due.
        expect(attempt.kind, `round ${String(round)}`).toBe("skipped");
        expect(row.status).toBe("cancelled");
        expect(world().provider().calls).toEqual([]);
      } else {
        sent += 1;
        // The claim committed first: the row was `sending`, so the cancel was refused.
        expect(cancelResult.status).toBe(409);
        expect(cancelResult.body).toMatchObject({ code: "invalid_transition" });
        expect(attempt.kind).toBe("sent");
        expect(row.status).toBe("sent");
        expect(world().provider().calls).toEqual([id]);
      }
    }
    expect(cancelled + sent).toBe(30);
  });

  it("cancel against a sender that is in the middle of its attempt (status sending) is refused and the mail is sent", async () => {
    const id = await world().enqueued();
    world().provider().failNext({ reason: "unavailable" });
    await world().pool.query(
      "update email_message set status = 'sending', attempts = 1, lease_until = $2 where id = $1",
      [id, new Date(world().clock.now().getTime() + 120_000)],
    );
    const result = await cancel(id);
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ code: "invalid_transition" });
    expect((await world().row(id)).status).toBe("sending");
  });

  it("resend while the original is sending is refused and creates no row", async () => {
    const id = await world().enqueued();
    await world().pool.query(
      "update email_message set status = 'sending', attempts = 1, lease_until = $2 where id = $1",
      [id, new Date(world().clock.now().getTime() + 120_000)],
    );
    const result = await ctx.call<ProblemBody>("POST", `/admin/email/messages/${id}/resend`);
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ code: "rule_violation", rule: "message_open" });
    expect(await world().count()).toBe(1);
  });

  it("resend against the sender finishing the original: either refused (still open) or accepted (final), never a half state", async () => {
    for (let round = 0; round < 12; round += 1) {
      world().provider().reset();
      const id = await world().enqueued();
      const [resend] = await Promise.all([
        ctx.call<{ messageId: string } & ProblemBody>("POST", `/admin/email/messages/${id}/resend`),
        world().attempt(id),
      ]);
      if (resend.status === 202) {
        // The original was already final when the resend looked.
        expect(["sent"]).toContain((await world().row(id)).status);
        expect((await world().row(resend.body.messageId)).status).toMatch(
          /^(pending|sending|sent)$/,
        );
      } else {
        expect(resend.status).toBe(409);
        expect(resend.body).toMatchObject({ rule: "message_open" });
      }
      await world().clear();
    }
  });

  it("two resends of one failed message make two independent rows with two keys, each sent once", async () => {
    const id = await world().enqueued();
    await world().pool.query(
      "update email_message set status = 'failed', attempts = 1, last_error_code = 'rejected' where id = $1",
      [id],
    );
    const results = await Promise.all([
      ctx.call<{ messageId: string }>("POST", `/admin/email/messages/${id}/resend`),
      ctx.call<{ messageId: string }>("POST", `/admin/email/messages/${id}/resend`),
    ]);
    expect(results.map((result) => result.status)).toEqual([202, 202]);
    const [first, second] = results.map((result) => result.body.messageId);
    expect(first).not.toBe(second);
    for (let wait = 0; wait < 100 && world().provider().sent.length < 2; wait += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(
      world()
        .provider()
        .sent.map((mail) => mail.idempotencyKey)
        .sort(),
    ).toEqual([first, second].sort());
  });

  it("a cancelled message is never sent by a later job run", async () => {
    const id = await world().enqueued();
    expect((await cancel(id)).status).toBe(200);
    world().clock.advanceMinutes(5);
    expect(await world().attempt(id)).toEqual({ kind: "skipped" });
    expect(world().provider().calls).toEqual([]);
  });
});
