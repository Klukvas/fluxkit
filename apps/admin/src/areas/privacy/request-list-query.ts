import type { PrivacyRequestStatus } from "@fluxkit/api-client";
import { readEnum, readPaging, writeQuery } from "../../router/query";
import { REQUEST_STATUSES } from "./privacy-view";

/** The request list's state in the URL (status filter and paging). Pure; readers never throw. */

/** The API's default page size of `GET /admin/privacy/requests` (`docs/api/privacy.md`). */
export const REQUEST_LIST_LIMIT = 50;

export interface RequestListQuery {
  status?: PrivacyRequestStatus;
  limit: number;
  offset: number;
}

export function readRequestListQuery(params: URLSearchParams): RequestListQuery {
  const status = readEnum(params, "status", REQUEST_STATUSES);
  return {
    ...(status === undefined ? {} : { status }),
    ...readPaging(params, { defaultLimit: REQUEST_LIST_LIMIT }),
  };
}

export function writeRequestListQuery(query: RequestListQuery): string {
  return writeQuery(
    { status: query.status, limit: query.limit, offset: query.offset },
    { limit: REQUEST_LIST_LIMIT, offset: 0 },
  );
}

/** A changed status starts at the first page again; the page size stays. */
export function withStatus(
  query: RequestListQuery,
  status: PrivacyRequestStatus | undefined,
): RequestListQuery {
  return {
    ...(status === undefined ? {} : { status }),
    limit: query.limit,
    offset: 0,
  };
}
