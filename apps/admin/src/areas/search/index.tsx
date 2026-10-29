import type { LazyFile } from "../../messages";
import { SearchStatusPage } from "./status-page";
import { SearchSynonymsPage } from "./synonyms-page";

/**
 * The Search area (search plan step 10b, permissions catalog.read to read and catalog.write to change) loads its own
 * messages only (`search`). With `SEARCH_ENABLED=false` the API mounts no search route: both screens then say that search
 * is switched off.
 */
export const MESSAGE_FILES: readonly LazyFile[] = ["search"];

/** `/search`: the engine, the index of every language, the sync queue and the rebuild action. */
export { SearchStatusPage };
/** `/search/synonyms`: the synonym groups per language. */
export { SearchSynonymsPage };
