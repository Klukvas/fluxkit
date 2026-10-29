import { describe, expect, it } from "vitest";
import {
  PRIVACY_REQUEST_CHANNELS,
  PRIVACY_REQUEST_KINDS,
  PRIVACY_REQUEST_STATUSES,
  PRIVACY_REQUEST_SUBJECT_KINDS,
  REQUEST_MAX_TOTAL_DAYS,
  REQUEST_RESPONSE_DAYS,
  decideRequestTransition,
  extendRequestDueAt,
  isRequestOverdue,
  requestDueAt,
} from "./request.js";

const DAY = 24 * 60 * 60 * 1000;
const RECEIVED = new Date("2026-11-01T09:30:00.000Z");

describe("the privacy request vocabulary", () => {
  it("is the one in ADR 0033 decision 9", () => {
    expect(PRIVACY_REQUEST_KINDS).toEqual(["export", "erasure"]);
    expect(PRIVACY_REQUEST_SUBJECT_KINDS).toEqual(["customer", "email"]);
    expect(PRIVACY_REQUEST_CHANNELS).toEqual(["self_service", "admin"]);
    expect(PRIVACY_REQUEST_STATUSES).toEqual(["received", "in_progress", "completed", "rejected"]);
  });
});

describe("requestDueAt", () => {
  it("is 30 days after the request was received", () => {
    expect(REQUEST_RESPONSE_DAYS).toBe(30);
    expect(requestDueAt(RECEIVED).toISOString()).toBe("2026-12-01T09:30:00.000Z");
    expect(requestDueAt(RECEIVED).getTime()).toBe(RECEIVED.getTime() + 30 * DAY);
  });

  it("refuses an invalid time and does not change its input", () => {
    expect(() => requestDueAt(new Date(Number.NaN))).toThrow(RangeError);
    const input = new Date(RECEIVED);
    requestDueAt(input);
    expect(input.getTime()).toBe(RECEIVED.getTime());
  });
});

describe("extendRequestDueAt (TODO(fluxkit): legal review of the extension limit)", () => {
  const due = requestDueAt(RECEIVED);

  it("moves the due date by whole days and needs a reason", () => {
    const result = extendRequestDueAt({
      receivedAt: RECEIVED,
      dueAt: due,
      extraDays: 15,
      reason: "  Complex request  ",
    });
    expect(result).toEqual({
      ok: true,
      dueAt: new Date(due.getTime() + 15 * DAY),
      reason: "Complex request",
    });
  });

  it("refuses an empty or too long reason", () => {
    for (const reason of ["", "   ", "x".repeat(501)]) {
      expect(
        extendRequestDueAt({ receivedAt: RECEIVED, dueAt: due, extraDays: 5, reason }),
      ).toEqual({
        ok: false,
        reason: "invalid_reason",
      });
    }
  });

  it("refuses a step that is not a whole number of days from 1", () => {
    for (const extraDays of [0, -3, 1.5, Number.NaN]) {
      expect(
        extendRequestDueAt({ receivedAt: RECEIVED, dueAt: due, extraDays, reason: "ok" }),
      ).toEqual({
        ok: false,
        reason: "invalid_days",
      });
    }
  });

  it("never lets the total pass the maximum since the request was received", () => {
    expect(REQUEST_MAX_TOTAL_DAYS).toBe(90);
    const limit = new Date(RECEIVED.getTime() + 90 * DAY);
    expect(
      extendRequestDueAt({ receivedAt: RECEIVED, dueAt: due, extraDays: 60, reason: "ok" }),
    ).toEqual({
      ok: true,
      dueAt: limit,
      reason: "ok",
    });
    expect(
      extendRequestDueAt({ receivedAt: RECEIVED, dueAt: due, extraDays: 61, reason: "ok" }),
    ).toEqual({
      ok: false,
      reason: "extension_too_long",
    });
  });
});

describe("decideRequestTransition", () => {
  it("lets a request be worked on, completed or rejected, and nothing else", () => {
    const allowed = new Set([
      "received>in_progress",
      "received>completed",
      "received>rejected",
      "in_progress>completed",
      "in_progress>rejected",
    ]);
    for (const from of PRIVACY_REQUEST_STATUSES) {
      for (const to of PRIVACY_REQUEST_STATUSES) {
        const decision = decideRequestTransition(from, to);
        expect(decision.ok, `${from} -> ${to}`).toBe(allowed.has(`${from}>${to}`));
      }
    }
  });

  it("names a closed request request_closed and any other refusal invalid_transition", () => {
    expect(decideRequestTransition("completed", "in_progress")).toEqual({
      ok: false,
      reason: "request_closed",
    });
    expect(decideRequestTransition("rejected", "completed")).toEqual({
      ok: false,
      reason: "request_closed",
    });
    expect(decideRequestTransition("completed", "completed")).toEqual({
      ok: false,
      reason: "request_closed",
    });
    expect(decideRequestTransition("in_progress", "received")).toEqual({
      ok: false,
      reason: "invalid_transition",
    });
    expect(decideRequestTransition("received", "received")).toEqual({
      ok: false,
      reason: "invalid_transition",
    });
  });

  it("refuses an unknown status (corrupt data or a bug)", () => {
    expect(() => decideRequestTransition("bogus" as never, "completed")).toThrow(RangeError);
    expect(() => decideRequestTransition("received", "bogus" as never)).toThrow(RangeError);
  });
});

describe("isRequestOverdue", () => {
  const dueAt = requestDueAt(RECEIVED);

  it("is true only for an open request after its due time", () => {
    expect(isRequestOverdue({ status: "received", dueAt }, new Date(dueAt.getTime() + 1))).toBe(
      true,
    );
    expect(isRequestOverdue({ status: "in_progress", dueAt }, new Date(dueAt.getTime() + 1))).toBe(
      true,
    );
    expect(isRequestOverdue({ status: "received", dueAt }, dueAt)).toBe(false);
    expect(isRequestOverdue({ status: "received", dueAt }, new Date(dueAt.getTime() - 1))).toBe(
      false,
    );
  });

  it("is false for a request that is answered, however late", () => {
    const later = new Date(dueAt.getTime() + 365 * DAY);
    expect(isRequestOverdue({ status: "completed", dueAt }, later)).toBe(false);
    expect(isRequestOverdue({ status: "rejected", dueAt }, later)).toBe(false);
  });
});
