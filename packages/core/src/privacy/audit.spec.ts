import { describe, expect, it } from "vitest";
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_DETAIL_MAX_BYTES,
  ADMIN_AUDIT_TARGET_KINDS,
  buildAdminAuditEvent,
  isAdminAuditAction,
} from "./audit.js";

const ID = "11111111-1111-4111-8111-111111111111";

describe("the admin audit action list (ADR 0033 decision 9)", () => {
  it("is the documented list, and reads of customer or order details are not in it", () => {
    expect([...ADMIN_AUDIT_ACTIONS]).toEqual([
      "customer.deactivated",
      "customer.activated",
      "customer.unlocked",
      "admin_user.created",
      "admin_user.role_changed",
      "admin_user.deactivated",
      "admin_user.activated",
      "admin_user.password_reset",
      "privacy.lookup",
      "privacy.exported",
      "privacy.erased",
      "privacy.request_changed",
    ]);
    expect(ADMIN_AUDIT_ACTIONS.some((action) => action.endsWith(".viewed"))).toBe(false);
    expect([...ADMIN_AUDIT_TARGET_KINDS]).toEqual([
      "customer",
      "order",
      "admin_user",
      "privacy_request",
    ]);
  });

  it("recognises exactly those actions", () => {
    for (const action of ADMIN_AUDIT_ACTIONS) expect(isAdminAuditAction(action)).toBe(true);
    for (const other of ["customer.viewed", "", "privacy", "PRIVACY.LOOKUP", 5, null]) {
      expect(isAdminAuditAction(other)).toBe(false);
    }
  });
});

describe("buildAdminAuditEvent", () => {
  it("accepts an action, a target and codes and counts", () => {
    expect(
      buildAdminAuditEvent({
        action: "privacy.erased",
        targetKind: "privacy_request",
        targetId: ID,
        detail: { ordersAnonymised: 3, mailDeleted: 12, blocked: false, blockers: ["open_order"] },
      }),
    ).toEqual({
      action: "privacy.erased",
      targetKind: "privacy_request",
      targetId: ID,
      detail: { ordersAnonymised: 3, mailDeleted: 12, blocked: false, blockers: ["open_order"] },
    });
  });

  it("defaults the detail to an empty object", () => {
    expect(
      buildAdminAuditEvent({ action: "customer.unlocked", targetKind: "customer", targetId: ID })
        .detail,
    ).toEqual({});
  });

  it("refuses an unknown action, target kind or target id", () => {
    expect(() =>
      buildAdminAuditEvent({
        action: "customer.viewed" as never,
        targetKind: "customer",
        targetId: ID,
      }),
    ).toThrow(RangeError);
    expect(() =>
      buildAdminAuditEvent({
        action: "customer.unlocked",
        targetKind: "email" as never,
        targetId: ID,
      }),
    ).toThrow(RangeError);
    for (const targetId of ["", "not-a-uuid", "a@example.test", "7K3M-9QX2"]) {
      expect(() =>
        buildAdminAuditEvent({ action: "customer.unlocked", targetKind: "customer", targetId }),
      ).toThrow(RangeError);
    }
  });

  it("refuses personal data in the detail: an email, a name, a phone number, a sentence", () => {
    for (const value of [
      "buyer@example.test",
      "Іван Петренко",
      "Ivan Petrenko",
      "+380501234567",
      "Sentinel street 1",
      "has a space",
      "UPPER",
    ]) {
      expect(
        () =>
          buildAdminAuditEvent({
            action: "privacy.lookup",
            targetKind: "privacy_request",
            targetId: ID,
            detail: { note: value },
          }),
        value,
      ).toThrow(RangeError);
      expect(
        () =>
          buildAdminAuditEvent({
            action: "privacy.lookup",
            targetKind: "privacy_request",
            targetId: ID,
            detail: { list: [value] },
          }),
        value,
      ).toThrow(RangeError);
    }
  });

  it("refuses a detail key that is not a short word (a key can carry data too)", () => {
    for (const key of ["buyer@example.test", "has space", "", "1abc", "x".repeat(33)]) {
      expect(
        () =>
          buildAdminAuditEvent({
            action: "privacy.lookup",
            targetKind: "privacy_request",
            targetId: ID,
            detail: { [key]: 1 },
          }),
        key,
      ).toThrow(RangeError);
    }
  });

  it("refuses nested objects, null, floats and unsafe numbers", () => {
    for (const bad of [
      { a: 1 },
      null,
      undefined,
      1.5,
      Number.NaN,
      Number.MAX_SAFE_INTEGER + 1,
      -1,
    ]) {
      expect(() =>
        buildAdminAuditEvent({
          action: "privacy.lookup",
          targetKind: "privacy_request",
          targetId: ID,
          detail: { count: bad as never },
        }),
      ).toThrow(RangeError);
    }
  });

  it("refuses a detail over 2 KiB", () => {
    expect(ADMIN_AUDIT_DETAIL_MAX_BYTES).toBe(2048);
    const big = Array.from({ length: 200 }, (_, index) => `code_number_${String(index)}`);
    expect(() =>
      buildAdminAuditEvent({
        action: "privacy.erased",
        targetKind: "privacy_request",
        targetId: ID,
        detail: { codes: big },
      }),
    ).toThrow(RangeError);
  });

  it("does not keep a reference to the caller's detail", () => {
    const detail = { count: 1 };
    const event = buildAdminAuditEvent({
      action: "privacy.lookup",
      targetKind: "privacy_request",
      targetId: ID,
      detail,
    });
    detail.count = 2;
    expect(event.detail).toEqual({ count: 1 });
  });
});
