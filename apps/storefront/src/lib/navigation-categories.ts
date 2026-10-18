import type { NavigationCategory } from "../components/site-header";
import { StoreUnavailableError, type StoreData } from "./store-data";

/**
 * The top-level categories for the header, or `null` when they cannot be read. A header without category links is a
 * working page; the failure is already logged by the store data layer (`StoreUnavailableError`) or here (a refused
 * request). Anything else (a missing `API_INTERNAL_URL`, a bug) is not swallowed: it propagates.
 */
export async function loadNavigationCategories(
  data: StoreData,
  locale: string,
): Promise<NavigationCategory[] | null> {
  try {
    const outcome = await data.listCategories(locale);
    if (outcome.ok) {
      return outcome.data.items.map((category) => ({ slug: category.slug, name: category.name }));
    }
    console.error(
      `GET /store/categories answered ${outcome.status} ${outcome.problem.code}; the header shows no categories.`,
    );
    return null;
  } catch (error) {
    if (error instanceof StoreUnavailableError) return null;
    throw error;
  }
}
