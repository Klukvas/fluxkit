import type { LazyFile } from "../../messages";
import { EmailMessageDetailPage } from "./message-detail-page";
import { EmailMessagesPage } from "./messages-page";
import { EmailStatusPage } from "./status-page";
import { EmailTemplatePreviewPage, EmailTemplatesPage } from "./templates-page";

/** The Email area (email plan step 11, permission email.manage) loads its own messages only (`email`). */
export const MESSAGE_FILES: readonly LazyFile[] = ["email"];

/** `/email`: delivery status and the test send. */
export { EmailStatusPage };
/** `/email/messages`: the outbox with filters. */
export { EmailMessagesPage };
/** `/email/messages/:id`: one mail with its journal, resend and cancel. */
export { EmailMessageDetailPage };
/** `/email/templates`: the registered templates. */
export { EmailTemplatesPage };
/** `/email/templates/:key`: the sandboxed preview. */
export { EmailTemplatePreviewPage };
