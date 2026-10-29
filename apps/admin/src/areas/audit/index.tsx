import type { LazyFile } from "../../messages";
import { AuditLogPage } from "./audit-page";

/** The audit log (privacy plan step 9, owner only, `users.manage`) loads its own messages only (`audit`). */
export const MESSAGE_FILES: readonly LazyFile[] = ["audit"];

/** `/audit`: what admins did to customer accounts, admin users and privacy requests. */
export { AuditLogPage };
