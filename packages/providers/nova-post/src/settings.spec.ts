import { describe, expect, it } from "vitest";
import { isProviderSettingsIssueList } from "@fluxkit/core";
import { novaPostSettingsIssues, parseNovaPostSettings } from "./settings.js";
import { VALID_SETTINGS } from "./test-support/fixtures.js";

function issuesOf(settings: unknown): string[] {
  const issues = novaPostSettingsIssues(settings);
  expect(isProviderSettingsIssueList(issues)).toBe(true);
  return issues.map((issue) => `${issue.path}:${issue.code}`);
}

describe("Nova Post settings (the sender profile)", () => {
  it("accepts a complete profile, with or without the optional company, email and contract", () => {
    expect(issuesOf(VALID_SETTINGS)).toEqual([]);
    expect(
      issuesOf({
        ...VALID_SETTINGS,
        senderEmail: "shop@example.com",
        senderCompanyTin: "12345678",
        senderCompanyName: "ТОВ Приклад",
        payerContractNumber: "12345678",
        payerDefault: "Sender",
      }),
    ).toEqual([]);
    expect(parseNovaPostSettings(VALID_SETTINGS)?.senderDivisionId).toBe(
      VALID_SETTINGS.senderDivisionId,
    );
  });

  it("names each missing field", () => {
    expect(issuesOf({})).toEqual([
      "senderName:invalid_type",
      "senderPhone:invalid_type",
      "senderDivisionId:invalid_type",
      "payerDefault:invalid_value",
      "defaultParcel:invalid_type",
    ]);
    expect(parseNovaPostSettings({})).toBeUndefined();
  });

  it("refuses a one-word sender name (the carrier wants two words), a bad phone and a bad division", () => {
    expect(issuesOf({ ...VALID_SETTINGS, senderName: "Відправник" })).toEqual([
      "senderName:two_words_required",
    ]);
    for (const phone of ["+380000000001", "0501234567", "38000000000", "3800000000012"]) {
      expect(issuesOf({ ...VALID_SETTINGS, senderPhone: phone }), phone).toEqual([
        "senderPhone:invalid_format",
      ]);
    }
    expect(issuesOf({ ...VALID_SETTINGS, senderDivisionId: "1001" })).toEqual([
      "senderDivisionId:invalid_type",
    ]);
    expect(issuesOf({ ...VALID_SETTINGS, senderDivisionId: 0 })).toEqual([
      "senderDivisionId:too_small",
    ]);
    expect(
      issuesOf({
        ...VALID_SETTINGS,
        defaultParcel: { ...VALID_SETTINGS.defaultParcel, weightGrams: 0.5 },
      }),
    ).toEqual(["defaultParcel.weightGrams:invalid_type"]);
  });

  it("wants the company tax id and name together", () => {
    expect(issuesOf({ ...VALID_SETTINGS, senderCompanyTin: "12345678" })).toEqual([
      "senderCompanyName:company_tin_and_name_together",
    ]);
    expect(issuesOf({ ...VALID_SETTINGS, senderCompanyName: "ТОВ Приклад" })).toEqual([
      "senderCompanyTin:company_tin_and_name_together",
    ]);
  });

  it("refuses unknown keys one by one, and a key no path can name on the object itself", () => {
    expect(issuesOf({ ...VALID_SETTINGS, senderCityRef: "x", extra: 1 })).toEqual([
      "senderCityRef:unknown_key",
      "extra:unknown_key",
    ]);
    expect(issuesOf({ ...VALID_SETTINGS, "odd key": 1 })).toEqual([":unknown_key"]);
  });

  it("never answers an empty list for settings it cannot use", () => {
    for (const value of [null, "x", [], 1]) {
      expect(issuesOf(value).length, JSON.stringify(value)).toBeGreaterThan(0);
    }
  });
});
