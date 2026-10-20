import type { AdminResult } from "@fluxkit/api-client";
import { adminClient } from "./api";
import { useResource } from "./use-resource";

/** The users list is read only for owners (`users.manage`): at most this many pages of 100 (owner answer 11). */
const MAX_USER_PAGES = 10;
const USERS_PAGE_SIZE = 100;

/**
 * The emails of the admin users by id, for the actor labels of the journals (stock journal, order history). Only a
 * session that may read users (`enabled`: `users.manage`) makes the request; everyone else gets `null` and NO request
 * (owner answer 11: managers see "another admin" with a short id). Shared by the Stock tab and the orders area.
 */
export function useAdminEmails(enabled: boolean): ReadonlyMap<string, string> | null {
  const users = useResource(
    async (signal): Promise<AdminResult<ReadonlyMap<string, string> | null>> => {
      if (!enabled) return { ok: true, status: 200, data: null };
      const emails = new Map<string, string>();
      for (let page = 0; page < MAX_USER_PAGES; page += 1) {
        const result = await adminClient.listUsers({
          limit: USERS_PAGE_SIZE,
          offset: page * USERS_PAGE_SIZE,
          signal,
        });
        if (!result.ok) return result;
        for (const user of result.data.items) emails.set(user.id, user.email);
        if (emails.size >= result.data.total || result.data.items.length === 0) break;
      }
      return { ok: true, status: 200, data: emails };
    },
    [enabled],
  );
  return users.status === "ready" ? users.data : null;
}
