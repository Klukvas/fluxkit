import type { SeedSynonymGroup } from "../types.js";

/*
 * Synonym groups of the coffee demo (ADR 0034 decision 8): only for words that the coffee titles contain (each group has at
 * least one term from a title of its locale; `coffee-seed.spec.ts` checks it). They show different words for one thing
 * (`трубочка`/`соломинка`), Russian query words (`кофемашина`, `лёд`, `сливки`) and the alternation the Ukrainian stemmer cannot
 * reach (`лід`/`льоду`, like `нога`/`нозі` in ADR 0034 decision 6). Terms are in the stored form of core `parseSynonymTerms`
 * (lower case, single spaces) and no term repeats within a locale. Written only with `SEARCH_ENABLED=true`.
 */
export const coffeeSynonymGroups: readonly SeedSynonymGroup[] = [
  { locale: "uk", terms: ["стаканчик", "стакан"] },
  { locale: "uk", terms: ["трубочка", "соломинка", "соломка"] },
  { locale: "uk", terms: ["кавомашина", "кофемашина"] },
  { locale: "uk", terms: ["кавомолка", "кофемолка"] },
  { locale: "uk", terms: ["лід", "льоду", "лёд", "лед"] },
  { locale: "uk", terms: ["кришка", "крышка"] },
  { locale: "uk", terms: ["вершки", "сливки"] },
  { locale: "uk", terms: ["холдер", "капхолдер", "манжета"] },
  { locale: "uk", terms: ["пітчер", "питчер", "молочник"] },
  { locale: "uk", terms: ["розмішувачі", "мішалки", "размешиватели"] },
  { locale: "uk", terms: ["рукавички", "перчатки"] },
  { locale: "uk", terms: ["серветки", "салфетки"] },
  { locale: "en", terms: ["pitcher", "jug"] },
  { locale: "en", terms: ["decaf", "decaffeinated"] },
  { locale: "en", terms: ["stirrers", "stir sticks"] },
  { locale: "en", terms: ["napkins", "serviettes"] },
];
