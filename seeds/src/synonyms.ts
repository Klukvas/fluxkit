import type { SeedSynonymGroup } from "./types.js";

/*
 * Demo synonym groups of catalog search (ADR 0034 decision 8; search plan step 11). Generic words only, no brand or client
 * vocabulary. They show what the engine's synonyms are for: what the stemmers cannot reach (the alternation `нога`/`нозі`,
 * the documented exception of ADR 0034 decision 6, and irregular English plurals), different words for one thing
 * (`викрутка`/`відвертка`) and Russian query words (`рубашка`, `отвертка`, `худи` and the groups for words of the demo titles,
 * only where a demo product has the word). Terms are written as the admin API stores them (core `parseSynonymTerms`: lower
 * case, single spaces), and no term repeats within a locale: the runner treats a group as existing when any of its terms is
 * already in a group of that locale. So a database seeded before 2026-11-06 gets the new groups but not `отвертка` and `худи`
 * (their groups exist; the runner adds no term to them): an admin adds them in the Search area. Written only with
 * `SEARCH_ENABLED=true`.
 */
export const demoSynonymGroups: readonly SeedSynonymGroup[] = [
  { locale: "uk", terms: ["нога", "ноги", "нозі"] },
  { locale: "uk", terms: ["викрутка", "відвертка", "отвертка"] },
  { locale: "uk", terms: ["сорочка", "рубашка"] },
  { locale: "uk", terms: ["худі", "толстовка", "худи"] },
  // Russian query words for words of the demo titles (UX round 2, 2026-11-06); nothing for "gift", no product has it.
  { locale: "uk", terms: ["молоток", "молоточек"] },
  { locale: "uk", terms: ["розвідний", "разводной"] },
  { locale: "uk", terms: ["лляна", "льняная"] },
  { locale: "uk", terms: ["електронна", "электронная"] },
  { locale: "en", terms: ["scarf", "scarves"] },
  { locale: "en", terms: ["knife", "knives"] },
  { locale: "en", terms: ["mouse", "mice"] },
  { locale: "en", terms: ["man", "men"] },
  { locale: "en", terms: ["woman", "women"] },
  { locale: "en", terms: ["foot", "feet"] },
  { locale: "en", terms: ["wrench", "spanner"] },
];
