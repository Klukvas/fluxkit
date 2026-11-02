import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import uk from "../messages/uk.json";
import { checkPhone, formatPhoneTyping, phoneFailure, phoneForDisplay } from "./phone";

describe("checkout phone (libphonenumber-js, min metadata)", () => {
  it("shows a Ukrainian number in the national format while it is typed", () => {
    expect(formatPhoneTyping("050", "UA")).toBe("050");
    expect(formatPhoneTyping("0501234567", "UA")).toBe("050 123 4567");
    expect(formatPhoneTyping("+380501234567", "UA")).toBe("+380 50 123 4567");
  });

  it("keeps text the formatter cannot read instead of emptying the field", () => {
    expect(formatPhoneTyping("abc", "UA")).toBe("abc");
  });

  it("sends E.164 for a national or an international Ukrainian number", () => {
    expect(checkPhone("050 123 4567", "UA")).toEqual({ ok: true, e164: "+380501234567" });
    expect(checkPhone("+380 50 123 4567", "UA")).toEqual({ ok: true, e164: "+380501234567" });
    expect(checkPhone(" (050) 123-45-67 ", "UA")).toEqual({ ok: true, e164: "+380501234567" });
  });

  it("reads a + number of another country as that country's", () => {
    expect(checkPhone("+48 512 345 678", "UA")).toEqual({ ok: true, e164: "+48512345678" });
  });

  it("refuses a number that is too short, too long or not a number, with the reason", () => {
    expect(checkPhone("050 12", "UA")).toEqual({ ok: false, problem: "too_short" });
    expect(checkPhone("050 123 4567 89", "UA")).toEqual({ ok: false, problem: "too_long" });
    expect(checkPhone("phone", "UA")).toEqual({ ok: false, problem: "invalid" });
    expect(checkPhone("+999 123 456 789", "UA")).toEqual({ ok: false, problem: "invalid" });
  });

  it("produces only numbers the API accepts (core normalizePhone: optional +, 7 to 15 digits)", () => {
    for (const text of ["050 123 4567", "+380 44 123 4567", "+48 512 345 678", "+1 415 555 2671"]) {
      const result = checkPhone(text, "UA");
      expect(result.ok, text).toBe(true);
      if (result.ok) expect(result.e164).toMatch(/^\+[0-9]{7,15}$/);
    }
  });

  it("shows an account's stored phone formatted", () => {
    expect(phoneForDisplay("+380501234567", "UA")).toBe("050 123 4567");
    expect(phoneForDisplay("0501234567", "UA")).toBe("050 123 4567");
    expect(phoneForDisplay("+48512345678", "UA")).toBe("+48 512 345 678");
    expect(phoneForDisplay("12", "UA")).toBe("12");
  });

  it("marks the phone field with a friendly text in both languages", () => {
    for (const problem of ["too_short", "too_long", "invalid"] as const) {
      const failure = phoneFailure("phone", problem);
      expect(failure.fieldErrors).toEqual([
        { path: "phone", code: problem, messageKey: `checkout.field.phone.error.${problem}` },
      ]);
      const key = `checkout.field.phone.error.${problem}`;
      expect((uk as Record<string, string>)[key], key).toBeTruthy();
      expect((en as Record<string, string>)[key], key).toBeTruthy();
    }
  });
});
