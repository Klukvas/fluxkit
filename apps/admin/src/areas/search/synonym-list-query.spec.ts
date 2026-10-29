import { describe, expect, it } from "vitest";
import {
  SYNONYM_LIST_LIMIT,
  listOptions,
  readSynonymListQuery,
  withLocale,
  writeSynonymListQuery,
} from "./synonym-list-query";

const LOCALES = ["uk", "en"];

describe("readSynonymListQuery", () => {
  it("is the first page of every language without a query string", () => {
    expect(readSynonymListQuery(new URLSearchParams(), LOCALES)).toEqual({
      locale: "",
      limit: SYNONYM_LIST_LIMIT,
      offset: 0,
    });
  });

  it("keeps a configured language and a valid offset", () => {
    expect(readSynonymListQuery(new URLSearchParams("locale=en&offset=50"), LOCALES)).toEqual({
      locale: "en",
      limit: SYNONYM_LIST_LIMIT,
      offset: 50,
    });
  });

  it("falls back to no filter for a language the shop does not have and for hand-edited paging", () => {
    expect(
      readSynonymListQuery(new URLSearchParams("locale=xx&offset=-3&limit=9999"), LOCALES),
    ).toEqual({ locale: "", limit: SYNONYM_LIST_LIMIT, offset: 0 });
  });
});

describe("writeSynonymListQuery and withLocale", () => {
  it("writes only what differs from the first unfiltered page", () => {
    expect(writeSynonymListQuery({ locale: "", limit: SYNONYM_LIST_LIMIT, offset: 0 })).toBe("");
    expect(writeSynonymListQuery({ locale: "uk", limit: SYNONYM_LIST_LIMIT, offset: 50 })).toBe(
      "?locale=uk&offset=50",
    );
  });

  it("starts at the first page when the language changes", () => {
    expect(withLocale({ locale: "uk", limit: SYNONYM_LIST_LIMIT, offset: 50 }, "en")).toEqual({
      locale: "en",
      limit: SYNONYM_LIST_LIMIT,
      offset: 0,
    });
  });
});

describe("listOptions", () => {
  it("sends the language only when one is chosen", () => {
    expect(listOptions({ locale: "", limit: 50, offset: 0 })).toEqual({ limit: 50, offset: 0 });
    expect(listOptions({ locale: "uk", limit: 50, offset: 100 })).toEqual({
      locale: "uk",
      limit: 50,
      offset: 100,
    });
  });
});
