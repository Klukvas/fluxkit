import { describe, expect, it } from "vitest";
import { privacySubjectScope } from "./subject-scope.js";

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
