import { describe, expect, it } from "vitest";
import {
  decideEmailTransition,
  EMAIL_MESSAGE_ACTORS,
  EMAIL_MESSAGE_STATUSES,
  EMAIL_MESSAGE_TRANSITIONS,
  EMAIL_RETENTION_DAYS,
  emailRetentionDays,
  isFinalEmailStatus,
  type EmailMessageActor,
  type EmailMessageStatus,
} from "./status.js";

/**
 * A literal copy of ADR 0031 decisions 5 to 7 as a table (from, to, actors). The implementation's table must equal it,
 * and every pair outside it must be refused for every actor.
 */
const EXPECTED: [EmailMessageStatus | null, EmailMessageStatus, EmailMessageActor[]][] = [
  // Enqueued by a handler or an auth flow (system), or by an admin (resend, test send).
  [null, "pending", ["system", "admin"]],
  // Claim.
  ["pending", "sending", ["system"]],
  // Re-claim of a row whose lease expired (a crashed sender): attempts + 1, same idempotency key.
  ["sending", "sending", ["system"]],
  // Record.
  ["sending", "sent", ["system"]],
  ["sending", "pending", ["system"]],
  ["sending", "failed", ["system"]],
  ["sending", "unknown", ["system"]],
  // The claim finds a pending row past its deadline: failed deadline_passed.
  ["pending", "failed", ["system"]],
  // Admin cancel, only from pending.
  ["pending", "cancelled", ["admin"]],
];

const STARTS: (EmailMessageStatus | null)[] = [null, ...EMAIL_MESSAGE_STATUSES];

describe("email message statuses", () => {
  it("are exactly the six of ADR 0031", () => {
    expect([...EMAIL_MESSAGE_STATUSES]).toEqual([
      "pending",
      "sending",
      "sent",
      "failed",
      "unknown",
      "cancelled",
    ]);
    expect([...EMAIL_MESSAGE_ACTORS]).toEqual(["system", "admin"]);
  });

  it("the transition table is data equal to the ADR's table, deeply frozen", () => {
    const actual = EMAIL_MESSAGE_TRANSITIONS.map((rule) => [rule.from, rule.to, [...rule.actors]]);
    expect(actual).toEqual(EXPECTED);
    expect(Object.isFrozen(EMAIL_MESSAGE_TRANSITIONS)).toBe(true);
    for (const rule of EMAIL_MESSAGE_TRANSITIONS) {
      expect(Object.isFrozen(rule)).toBe(true);
      expect(Object.isFrozen(rule.actors)).toBe(true);
    }
  });

  it("decides the whole start x target x actor matrix", () => {
    for (const from of STARTS) {
      for (const to of EMAIL_MESSAGE_STATUSES) {
        for (const actor of EMAIL_MESSAGE_ACTORS) {
          const row = EXPECTED.find(([f, t]) => f === from && t === to);
          const decision = decideEmailTransition(from, to, actor);
          const label = `${String(from)} -> ${to} by ${actor}`;
          if (row === undefined) {
            expect(decision, label).toEqual({ ok: false, reason: "invalid_transition" });
          } else if (!row[2].includes(actor)) {
            expect(decision, label).toEqual({ ok: false, reason: "not_allowed_for_actor" });
          } else {
            expect(decision, label).toEqual({ ok: true, from, to });
          }
        }
      }
    }
  });

  it("an admin cancels only a pending mail", () => {
    expect(decideEmailTransition("pending", "cancelled", "admin").ok).toBe(true);
    for (const from of ["sending", "sent", "failed", "unknown", "cancelled"] as const) {
      expect(decideEmailTransition(from, "cancelled", "admin")).toEqual({
        ok: false,
        reason: "invalid_transition",
      });
    }
    expect(decideEmailTransition("pending", "cancelled", "system")).toEqual({
      ok: false,
      reason: "not_allowed_for_actor",
    });
  });

  it("nothing leaves sent, failed, unknown or cancelled; unknown is never retried automatically", () => {
    for (const status of ["sent", "failed", "unknown", "cancelled"] as const) {
      expect(isFinalEmailStatus(status), status).toBe(true);
      for (const to of EMAIL_MESSAGE_STATUSES) {
        for (const actor of EMAIL_MESSAGE_ACTORS) {
          expect(decideEmailTransition(status, to, actor).ok, `${status} -> ${to}`).toBe(false);
        }
      }
    }
    expect(isFinalEmailStatus("pending")).toBe(false);
    expect(isFinalEmailStatus("sending")).toBe(false);
  });

  it("a mail is created pending only", () => {
    for (const to of EMAIL_MESSAGE_STATUSES.filter((status) => status !== "pending")) {
      expect(decideEmailTransition(null, to, "system").ok, to).toBe(false);
    }
  });

  it("throws for an unknown status or actor (corrupt data or a bug)", () => {
    expect(() => decideEmailTransition("queued" as EmailMessageStatus, "sent", "system")).toThrow(
      RangeError,
    );
    expect(() => decideEmailTransition("pending", "done" as EmailMessageStatus, "system")).toThrow(
      RangeError,
    );
    expect(() => decideEmailTransition("pending", "sending", "robot" as EmailMessageActor)).toThrow(
      RangeError,
    );
    expect(() => isFinalEmailStatus("__proto__" as EmailMessageStatus)).toThrow(RangeError);
  });
});

describe("retention (ADR 0031 decision 8)", () => {
  it("keeps sent and cancelled 30 days, failed and unknown 90 days, and never purges an open mail", () => {
    expect(EMAIL_RETENTION_DAYS).toEqual({ sent: 30, cancelled: 30, failed: 90, unknown: 90 });
    expect(Object.isFrozen(EMAIL_RETENTION_DAYS)).toBe(true);
    expect(emailRetentionDays("sent")).toBe(30);
    expect(emailRetentionDays("cancelled")).toBe(30);
    expect(emailRetentionDays("failed")).toBe(90);
    expect(emailRetentionDays("unknown")).toBe(90);
    expect(emailRetentionDays("pending")).toBeNull();
    expect(emailRetentionDays("sending")).toBeNull();
  });

  it("every final status has a retention and no other does", () => {
    for (const status of EMAIL_MESSAGE_STATUSES) {
      expect(emailRetentionDays(status) !== null, status).toBe(isFinalEmailStatus(status));
    }
  });
});
