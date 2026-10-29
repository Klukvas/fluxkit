import { describe, expect, it } from "vitest";
import { isInPrivacySubjectScope, privacySubjectScope } from "./subject-scope.js";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const ADDRESS = "buyer@example.test";

describe("privacySubjectScope (ADR 0035, privacy review F1)", () => {
  it("a customer subject with an UNVERIFIED address reaches the account only, never guest data by address", () => {
    expect(
      privacySubjectScope({
        kind: "customer",
        account: { id: ACCOUNT_ID, email: ADDRESS, emailVerified: false },
      }),
    ).toEqual({ customerId: ACCOUNT_ID, guestEmail: null });
  });

  it("a customer subject with a verified address also reaches the guest orders and guest mail of that address", () => {
    expect(
      privacySubjectScope({
        kind: "customer",
        account: { id: ACCOUNT_ID, email: ADDRESS, emailVerified: true },
      }),
    ).toEqual({ customerId: ACCOUNT_ID, guestEmail: ADDRESS });
  });

  it("an email subject (the owner checked the identity off-band) reaches the guest data of the address and the account with it", () => {
    expect(privacySubjectScope({ kind: "email", email: ADDRESS, account: null })).toEqual({
      customerId: null,
      guestEmail: ADDRESS,
    });
    for (const emailVerified of [false, true]) {
      expect(
        privacySubjectScope({
          kind: "email",
          email: ADDRESS,
          account: { id: ACCOUNT_ID, email: ADDRESS, emailVerified },
        }),
      ).toEqual({ customerId: ACCOUNT_ID, guestEmail: ADDRESS });
    }
  });

  it("refuses inconsistent input (a bug, not a request): a customer subject without an account, an email subject without an address or with another account's address", () => {
    expect(() => privacySubjectScope({ kind: "customer", account: null })).toThrow(RangeError);
    expect(() => privacySubjectScope({ kind: "email", email: "", account: null })).toThrow(
      RangeError,
    );
    expect(() =>
      privacySubjectScope({
        kind: "email",
        email: ADDRESS,
        account: { id: ACCOUNT_ID, email: "other@example.test", emailVerified: true },
      }),
    ).toThrow(RangeError);
  });
});

describe("isInPrivacySubjectScope (ADR 0035, privacy review F2)", () => {
  const OTHER_ACCOUNT = "22222222-2222-4222-8222-222222222222";
  const both = { customerId: ACCOUNT_ID, guestEmail: ADDRESS };

  it("reaches the account's rows whatever address they carry", () => {
    expect(
      isInPrivacySubjectScope(both, { customerId: ACCOUNT_ID, email: "typed@example.test" }),
    ).toBe(true);
    expect(isInPrivacySubjectScope(both, { customerId: ACCOUNT_ID, email: null })).toBe(true);
  });

  it("reaches a GUEST row (no account) with the address", () => {
    expect(isInPrivacySubjectScope(both, { customerId: null, email: ADDRESS })).toBe(true);
    expect(
      isInPrivacySubjectScope(
        { customerId: null, guestEmail: ADDRESS },
        { customerId: null, email: ADDRESS },
      ),
    ).toBe(true);
  });

  it("R2: never reaches a row of ANOTHER account that carries the address (a signed-in customer may type any email)", () => {
    expect(isInPrivacySubjectScope(both, { customerId: OTHER_ACCOUNT, email: ADDRESS })).toBe(
      false,
    );
    expect(
      isInPrivacySubjectScope(
        { customerId: null, guestEmail: ADDRESS },
        { customerId: OTHER_ACCOUNT, email: ADDRESS },
      ),
    ).toBe(false);
  });

  it("reaches nothing by address without a guest address in the scope, and no guest row of another address", () => {
    expect(
      isInPrivacySubjectScope(
        { customerId: ACCOUNT_ID, guestEmail: null },
        { customerId: null, email: ADDRESS },
      ),
    ).toBe(false);
    expect(isInPrivacySubjectScope(both, { customerId: null, email: "other@example.test" })).toBe(
      false,
    );
    expect(isInPrivacySubjectScope(both, { customerId: null, email: null })).toBe(false);
  });
});
