import type { AdminResult, AdminUser, AdminUserList } from "@fluxkit/api-client";
import { failureFromError } from "../../lib/failure";
import { sameEmail } from "./user-form";

/**
 * After a create whose answer never arrived, the screen tells the owner what is stored: whether a user with that email
 * exists now. The API has no search by email, so this reads the list (ordered by email) page by page, bounded like the
 * actor labels' read (`lib/use-admin-emails.ts`). Reads only: the create is never sent again by the screen. Finding the
 * email does not prove that this very request created it (another owner may have), and the screen says so.
 */

export const LOOKUP_PAGE_SIZE = 100;
export const LOOKUP_MAX_PAGES = 10;

export type LookupResult =
  | { kind: "found"; user: AdminUser }
  | { kind: "absent" }
  /** More users than the bounded read covers, and the email was not among them. */
  | { kind: "notChecked" }
  | { kind: "unreadable" };

export async function findUserByEmail(
  email: string,
  listPage: (offset: number) => Promise<AdminResult<AdminUserList>>,
): Promise<LookupResult> {
  let seen = 0;
  for (let page = 0; page < LOOKUP_MAX_PAGES; page += 1) {
    let result: AdminResult<AdminUserList>;
    try {
      result = await listPage(page * LOOKUP_PAGE_SIZE);
    } catch (error) {
      // A lost connection or an unreadable answer: nothing to report; a bug is thrown again by `failureFromError`.
      failureFromError(error);
      return { kind: "unreadable" };
    }
    if (!result.ok) return { kind: "unreadable" };
    const found = result.data.items.find((user) => sameEmail(user.email, email));
    if (found !== undefined) return { kind: "found", user: found };
    seen += result.data.items.length;
    if (seen >= result.data.total || result.data.items.length === 0) return { kind: "absent" };
  }
  return { kind: "notChecked" };
}
