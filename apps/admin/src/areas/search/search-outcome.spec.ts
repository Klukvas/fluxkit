import type { AdminSearchRebuild, ProblemDetails } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import type { WriteOutcome } from "../../lib/run-write";
import {
  SYNONYM_FIELD_CODES,
  describeSearchProblem,
  describeSynonymFieldCode,
  rebuildNotice,
  synonymFieldErrors,
  synonymOutcome,
} from "./search-outcome";

function problem(
  status: number,
  code: string,
  extra: Partial<ProblemDetails> = {},
): WriteOutcome<never> {
  return {
    kind: "problem",
    status,
    retryAfter: null,
    problem: {
      type: "about:blank",
      title: "x",
      status,
      code: code as ProblemDetails["code"],
      detail: "ENGLISH-DETAIL",
      ...extra,
    },
  };
}

const REBUILD: AdminSearchRebuild = {
  requestedAt: "2026-10-29T12:00:00.000Z",
  locales: ["uk", "en"],
};

describe("rebuildNotice", () => {
  it("says the rebuild was requested (202), with the time and the locales, never that it finished", () => {
    expect(rebuildNotice({ kind: "ok", status: 202, data: REBUILD })).toEqual({
      kind: "requested",
      requestedAt: "2026-10-29T12:00:00.000Z",
      locales: ["uk", "en"],
    });
  });

  it("reads a 404 as search switched off, and a 403 as not allowed", () => {
    expect(rebuildNotice(problem(404, "not_found"))).toEqual({ kind: "off" });
    expect(rebuildNotice(problem(403, "forbidden"))).toEqual({ kind: "forbidden" });
  });

  it("shows another refusal through the message map, without the API's English text", () => {
    const notice = rebuildNotice(problem(429, "too_many_requests"));
    expect(notice).toEqual({
      kind: "refused",
      descriptor: { key: "errors.code.too_many_requests" },
    });
    expect(JSON.stringify(notice)).not.toContain("ENGLISH-DETAIL");
  });

  it("is honest about a lost answer: the request may or may not have been recorded", () => {
    expect(rebuildNotice({ kind: "unknown", failure: { kind: "network" } })).toEqual({
      kind: "unknown",
    });
    expect(rebuildNotice({ kind: "unknown", failure: { kind: "timeout" } })).toEqual({
      kind: "unknown",
    });
  });

  it("shows nothing for the caller's own abort", () => {
    expect(rebuildNotice({ kind: "aborted" })).toEqual({ kind: "idle" });
  });
});

describe("describeSearchProblem", () => {
  it("maps the search outage code and leaves other codes to the shell's map", () => {
    expect(describeSearchProblem(503, { code: "search_unavailable" })).toEqual({
      key: "errors.code.search_unavailable",
    });
    expect(describeSearchProblem(409, { code: "conflict" })).toEqual({
      key: "errors.code.conflict",
    });
    expect(describeSearchProblem(500, { code: "brand_new" })).toEqual({
      key: "errors.generic",
      code: "brand_new",
    });
  });
});

describe("describeSynonymFieldCode", () => {
  it("has its own message for every code of the synonym routes, and the shell's map for the rest", () => {
    for (const code of SYNONYM_FIELD_CODES) {
      expect(describeSynonymFieldCode(code)).toEqual({ key: `search.synonyms.error.${code}` });
    }
    expect([...SYNONYM_FIELD_CODES].sort()).toEqual(
      ["duplicate_terms", "invalid_term", "not_a_list", "too_few_terms", "too_many_terms"].sort(),
    );
    expect(describeSynonymFieldCode("invalid_value")).toEqual({
      key: "errors.reason.invalid_value",
    });
    expect(describeSynonymFieldCode("brand_new")).toEqual({
      key: "errors.generic",
      code: "brand_new",
    });
  });
});

describe("synonymFieldErrors", () => {
  it("puts the errors of terms and locale on their fields and the rest in the summary", () => {
    const outcome = problem(400, "validation_failed", {
      errors: [
        { path: "terms", code: "invalid_term" },
        { path: "terms", code: "duplicate_terms" },
        { path: "locale", code: "invalid_value" },
        { path: "other", code: "unknown_field" },
      ],
    });
    if (outcome.kind !== "problem") throw new Error("not a problem");
    expect(synonymFieldErrors(outcome.problem, outcome.status)).toEqual({
      terms: { key: "search.synonyms.error.invalid_term" },
      locale: { key: "errors.reason.invalid_value" },
      other: [{ key: "errors.reason.unknown_field" }],
    });
  });

  it("puts a problem without field errors in the summary", () => {
    const outcome = problem(500, "internal_error");
    if (outcome.kind !== "problem") throw new Error("not a problem");
    expect(synonymFieldErrors(outcome.problem, outcome.status)).toEqual({
      other: [{ key: "errors.code.internal_error" }],
    });
  });
});

describe("synonymOutcome", () => {
  it("is saved on 201, 200 and 204", () => {
    expect(synonymOutcome("create", { kind: "ok", status: 201, data: {} })).toEqual({
      kind: "saved",
    });
    expect(synonymOutcome("update", { kind: "ok", status: 200, data: {} })).toEqual({
      kind: "saved",
    });
    expect(synonymOutcome("delete", { kind: "ok", status: 204, data: undefined })).toEqual({
      kind: "saved",
    });
  });

  it("shows a 400 on the fields", () => {
    const outcome = problem(400, "validation_failed", {
      errors: [{ path: "terms", code: "too_few_terms" }],
    });
    expect(synonymOutcome("create", outcome)).toEqual({
      kind: "fields",
      errors: { terms: { key: "search.synonyms.error.too_few_terms" }, other: [] },
    });
  });

  it("says a group that is gone is gone (404 on update and delete): the list reloads, nothing else to do", () => {
    expect(synonymOutcome("update", problem(404, "not_found"))).toEqual({ kind: "gone" });
    // a delete of a group someone else already deleted has the result the admin wanted
    expect(synonymOutcome("delete", problem(404, "not_found"))).toEqual({ kind: "gone" });
  });

  it("says search is off when the create route is 404 (the routes are not mounted)", () => {
    expect(synonymOutcome("create", problem(404, "not_found"))).toEqual({ kind: "off" });
  });

  it("reads a 403 as not allowed and other problems through the message map", () => {
    expect(synonymOutcome("create", problem(403, "forbidden"))).toEqual({ kind: "forbidden" });
    expect(synonymOutcome("delete", problem(500, "internal_error"))).toEqual({
      kind: "refused",
      descriptor: { key: "errors.code.internal_error" },
    });
  });

  it("is honest about a lost answer and never repeats the write", () => {
    expect(synonymOutcome("create", { kind: "unknown", failure: { kind: "network" } })).toEqual({
      kind: "unknown",
    });
    expect(synonymOutcome("create", { kind: "aborted" })).toEqual({ kind: "idle" });
  });
});
