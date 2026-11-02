import { HELP_MESSAGE_FILES } from "./help-message-files";
import { HelpArticlePage, HelpIndexPage, HomeChecklist } from "./help-pages";

/**
 * The knowledge base (plan `docs/plans/2026-11-02-admin-knowledge-base.md`): every signed-in role may read it. Articles are
 * data in `content/` (one file per topic, replaced by a client fork); the area loads its own messages only (`help`).
 */
export const MESSAGE_FILES = HELP_MESSAGE_FILES;

/** `/help`: search, the getting-started checklist and the topics. */
export { HelpIndexPage };
/** `/help/:articleId`: one article. */
export { HelpArticlePage };
/** The start page's checklist card (lazily imported by `areas/home/home-page.tsx`). */
export { HomeChecklist };
