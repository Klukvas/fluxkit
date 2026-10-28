import type { ProblemDetails } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import { EMAIL_REFUSAL_RULES, describeEmailProblem } from "./email-errors";

function problem(extra: Partial<ProblemDetails>): ProblemDetails {
  return {
    type: "about:blank",
    title: "x",
    status: 409,
    code: "rule_violation",
    detail: "SECRET-ENGLISH-DETAIL",
    ...extra,
  };
}

describe("describeEmailProblem", () => {
  it("gives each refusal rule of docs/api/email.md its own message (hand-written list)", () => {
    expect([...EMAIL_REFUSAL_RULES].sort()).toEqual(
      [
        "address_undeliverable",
        "email_not_configured",
        "message_open",
        "not_pending",
        "not_resendable",
        "template_unavailable",
        "variables_invalid",
      ].sort(),
    );
    for (const rule of EMAIL_REFUSAL_RULES) {
      const code = rule === "not_pending" ? "invalid_transition" : "rule_violation";
      expect(describeEmailProblem(409, problem({ code, rule }), null)).toEqual({
        key: `mail.refusal.${rule}`,
      });
    }
  });

  it("explains the resend refusals the task names", () => {
    for (const rule of [
      "message_open",
      "not_resendable",
      "template_unavailable",
      "variables_invalid",
      "email_not_configured",
      "address_undeliverable",
    ]) {
      expect(describeEmailProblem(409, problem({ rule }), null).key).toBe(`mail.refusal.${rule}`);
    }
  });

  it("answers a 429 with the wait in minutes when the header is plausible, without it otherwise", () => {
    const limited = problem({ status: 429, code: "too_many_requests" });
    expect(describeEmailProblem(429, limited, "1800")).toEqual({
      key: "mail.refusal.rateLimitedWait",
      values: { minutes: 30 },
    });
    expect(describeEmailProblem(429, limited, "soon")).toEqual({ key: "mail.refusal.rateLimited" });
    expect(describeEmailProblem(429, limited, null)).toEqual({ key: "mail.refusal.rateLimited" });
  });

  it("passes everything else to the shell's map and never uses the API's detail", () => {
    expect(describeEmailProblem(403, problem({ status: 403, code: "forbidden" }), null)).toEqual({
      key: "errors.code.forbidden",
    });
    expect(describeEmailProblem(404, problem({ status: 404, code: "not_found" }), null)).toEqual({
      key: "errors.code.not_found",
    });
    const unknown = describeEmailProblem(409, problem({ rule: "something_new" }), null);
    expect(unknown).toEqual({ key: "errors.code.rule_violation", code: "something_new" });
    expect(JSON.stringify(unknown)).not.toContain("SECRET-ENGLISH-DETAIL");
  });

  it("does not turn a rule of another route into an email message", () => {
    expect(
      describeEmailProblem(409, problem({ code: "conflict", rule: "message_open" }), null).key,
    ).not.toBe("mail.refusal.message_open");
  });
});
