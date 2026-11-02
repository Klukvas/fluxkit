import type { HelpLibrary } from "../help-model";
import { CATALOG_ARTICLES, CATALOG_TOPIC } from "./catalog";
import { PRICES_STOCK_ARTICLES, PRICES_STOCK_TOPIC } from "./prices-stock";
import { SALES_ARTICLES, SALES_TOPIC } from "./sales";
import { SETTINGS_ARTICLES, SETTINGS_TOPIC } from "./settings";
import { START_ARTICLES, START_TOPIC } from "./start";

/**
 * The knowledge base of the template: topics in menu order, articles in reading order (previous and next follow it). A
 * client fork edits or replaces the files of this folder (`README.md` here); `help-content.spec.ts` checks the result.
 */
export const HELP_LIBRARY: HelpLibrary = {
  topics: [START_TOPIC, CATALOG_TOPIC, PRICES_STOCK_TOPIC, SALES_TOPIC, SETTINGS_TOPIC],
  articles: [
    ...START_ARTICLES,
    ...CATALOG_ARTICLES,
    ...PRICES_STOCK_ARTICLES,
    ...SALES_ARTICLES,
    ...SETTINGS_ARTICLES,
  ],
};
