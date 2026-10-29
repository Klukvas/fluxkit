import type { AdminListSynonymGroupsOptions } from "@fluxkit/api-client";
import { readEnum, readPaging, writeQuery } from "../../router/query";

/**
 * The synonym list's state in the URL (language filter and paging, so a list can be shared and reloaded). Pure. Readers
 * never throw: a hand-edited bad value means "no filter" or the first page; the API validates whatever is sent anyway.
 */

/** The API's default page size of `GET /admin/search/synonyms` (`docs/api/search.md`). */
export const SYNONYM_LIST_LIMIT = 50;

export interface SynonymListQuery {
  /** One of the shop's languages, or `""` for all. */
  locale: string;
  limit: number;
  offset: number;
}

export function readSynonymListQuery(
  params: URLSearchParams,
  locales: readonly string[],
): SynonymListQuery {
  return {
    locale: readEnum(params, "locale", locales) ?? "",
    ...readPaging(params, { defaultLimit: SYNONYM_LIST_LIMIT }),
  };
}

/** `?locale=…&limit=…&offset=…`, or `""` for the unfiltered first page. */
export function writeSynonymListQuery(query: SynonymListQuery): string {
  return writeQuery(
    { locale: query.locale, limit: query.limit, offset: query.offset },
    { limit: SYNONYM_LIST_LIMIT, offset: 0 },
  );
}

/** A changed language starts at the first page again; the page size stays. */
export function withLocale(query: SynonymListQuery, locale: string): SynonymListQuery {
  return { locale, limit: query.limit, offset: 0 };
}

export function listOptions(query: SynonymListQuery): AdminListSynonymGroupsOptions {
  return {
    ...(query.locale === "" ? {} : { locale: query.locale }),
    limit: query.limit,
    offset: query.offset,
  };
}
