import type { AdminPageOptions } from "@fluxkit/api-client";
import { readPaging, writeQuery, type Paging } from "../../router/query";

/**
 * The users list's state in the URL: the paging only (the API offers no filter: `GET /admin/users` takes `limit` and
 * `offset` and orders by email). Pure. A hand-edited bad value means the default; nothing else is kept in the URL.
 */

/** The API's default page size of `GET /admin/users` (`docs/api/auth.md`). */
export const USER_LIST_LIMIT = 50;

export function readUserListQuery(params: URLSearchParams): Paging {
  return readPaging(params, { defaultLimit: USER_LIST_LIMIT });
}

/** `?limit=…&offset=…`, or `""` for the first page at the default size. */
export function writeUserListQuery(query: Paging): string {
  return writeQuery(
    { limit: query.limit, offset: query.offset },
    { limit: USER_LIST_LIMIT, offset: 0 },
  );
}

export function listRequest(query: Paging): AdminPageOptions {
  return { limit: query.limit, offset: query.offset };
}
