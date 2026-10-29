/**
 * Synthetic Ukrainian product corpus and query set for spike S1 (docs/plans/2026-10-29-search.md, step 1).
 * Invented generic titles in five niches, no client data. Ground truth comes from the structure: a product is relevant to
 * a query when it has the query's noun lemma, adjective lemmas and brand. Everything is deterministic (seeded RNG).
 */
export type Niche = "clothes" | "tools" | "food" | "electronics" | "stationery";
type Gender = "f" | "m" | "n" | "p";

export interface Noun {
  readonly lemma: string;
  readonly gender: Gender;
  readonly niche: Niche;
  /** nominative, genitive, dative, accusative, instrumental, locative; empty for plural-only nouns */
  readonly singular: readonly string[];
  readonly plural: readonly string[];
}

const noun = (gender: Gender, niche: Niche, singular: string, plural: string): Noun => {
  const sg = singular === "" ? [] : singular.split(" ");
  const pl = plural === "" ? [] : plural.split(" ");
  const lemma = sg[0] ?? pl[0];
  if (lemma === undefined) throw new Error("noun without forms");
  return { lemma, gender, niche, singular: sg, plural: pl };
};

export const nouns: readonly Noun[] = [
  noun(
    "f",
    "clothes",
    "сорочка сорочки сорочці сорочку сорочкою сорочці",
    "сорочки сорочок сорочкам сорочки сорочками сорочках",
  ),
  noun(
    "f",
    "clothes",
    "футболка футболки футболці футболку футболкою футболці",
    "футболки футболок футболкам футболки футболками футболках",
  ),
  noun(
    "f",
    "clothes",
    "куртка куртки куртці куртку курткою куртці",
    "куртки курток курткам куртки куртками куртках",
  ),
  noun(
    "m",
    "clothes",
    "светр светра светру светр светром светрі",
    "светри светрів светрам светри светрами светрах",
  ),
  noun("p", "clothes", "", "штани штанів штанам штани штанами штанах"),
  noun("p", "clothes", "", "рукавички рукавичок рукавичкам рукавички рукавичками рукавичках"),
  noun(
    "f",
    "clothes",
    "рукавиця рукавиці рукавиці рукавицю рукавицею рукавиці",
    "рукавиці рукавиць рукавицям рукавиці рукавицями рукавицях",
  ),
  noun(
    "f",
    "clothes",
    "шапка шапки шапці шапку шапкою шапці",
    "шапки шапок шапкам шапки шапками шапках",
  ),
  noun("p", "clothes", "", "кросівки кросівок кросівкам кросівки кросівками кросівках"),
  noun(
    "m",
    "clothes",
    "рюкзак рюкзака рюкзаку рюкзак рюкзаком рюкзаку",
    "рюкзаки рюкзаків рюкзакам рюкзаки рюкзаками рюкзаках",
  ),
  noun(
    "m",
    "clothes",
    "ремінь ременя ременю ремінь ременем ремені",
    "ремені ременів ременям ремені ременями ременях",
  ),
  noun(
    "f",
    "clothes",
    "сукня сукні сукні сукню сукнею сукні",
    "сукні суконь сукням сукні сукнями сукнях",
  ),
  noun(
    "f",
    "clothes",
    "спідниця спідниці спідниці спідницю спідницею спідниці",
    "спідниці спідниць спідницям спідниці спідницями спідницях",
  ),
  noun(
    "m",
    "clothes",
    "шарф шарфа шарфу шарф шарфом шарфі",
    "шарфи шарфів шарфам шарфи шарфами шарфах",
  ),
  noun("p", "clothes", "", "черевики черевиків черевикам черевики черевиками черевиках"),
  noun("p", "clothes", "", "шкарпетки шкарпеток шкарпеткам шкарпетки шкарпетками шкарпетках"),
  noun(
    "f",
    "tools",
    "викрутка викрутки викрутці викрутку викруткою викрутці",
    "викрутки викруток викруткам викрутки викрутками викрутках",
  ),
  noun(
    "m",
    "tools",
    "молоток молотка молотку молоток молотком молотку",
    "молотки молотків молоткам молотки молотками молотках",
  ),
  noun(
    "m",
    "tools",
    "дриль дриля дрилю дриль дрилем дрилі",
    "дрилі дрилів дрилям дрилі дрилями дрилях",
  ),
  noun(
    "f",
    "tools",
    "пилка пилки пилці пилку пилкою пилці",
    "пилки пилок пилкам пилки пилками пилках",
  ),
  noun(
    "m",
    "tools",
    "ключ ключа ключу ключ ключем ключі",
    "ключі ключів ключам ключі ключами ключах",
  ),
  noun(
    "m",
    "tools",
    "набір набору набору набір набором наборі",
    "набори наборів наборам набори наборами наборах",
  ),
  noun(
    "f",
    "tools",
    "рулетка рулетки рулетці рулетку рулеткою рулетці",
    "рулетки рулеток рулеткам рулетки рулетками рулетках",
  ),
  noun(
    "f",
    "tools",
    "лопата лопати лопаті лопату лопатою лопаті",
    "лопати лопат лопатам лопати лопатами лопатах",
  ),
  noun(
    "m",
    "tools",
    "шуруповерт шуруповерта шуруповерту шуруповерт шуруповертом шуруповерті",
    "шуруповерти шуруповертів шуруповертам шуруповерти шуруповертами шуруповертах",
  ),
  noun(
    "f",
    "tools",
    "болгарка болгарки болгарці болгарку болгаркою болгарці",
    "болгарки болгарок болгаркам болгарки болгарками болгарках",
  ),
  noun(
    "n",
    "tools",
    "свердло свердла свердлу свердло свердлом свердлі",
    "свердла свердл свердлам свердла свердлами свердлах",
  ),
  noun("m", "food", "чай чаю чаю чай чаєм чаї", "чаї чаїв чаям чаї чаями чаях"),
  noun("f", "food", "кава кави каві каву кавою каві", "кави кав кавам кави кавами кавах"),
  noun(
    "n",
    "food",
    "печиво печива печиву печиво печивом печиві",
    "печива печив печивам печива печивами печивах",
  ),
  noun("f", "food", "олія олії олії олію олією олії", "олії олій оліям олії оліями оліях"),
  noun("m", "food", "мед меду меду мед медом меді", "меди медів медам меди медами медах"),
  noun("m", "food", "сік соку соку сік соком соці", "соки соків сокам соки соками соках"),
  noun("n", "food", "борошно борошна борошну борошно борошном борошні", ""),
  noun("p", "food", "", "макарони макаронів макаронам макарони макаронами макаронах"),
  noun("m", "food", "сир сиру сиру сир сиром сирі", "сири сирів сирам сири сирами сирах"),
  noun(
    "m",
    "food",
    "шоколад шоколаду шоколаду шоколад шоколадом шоколаді",
    "шоколади шоколадів шоколадам шоколади шоколадами шоколадах",
  ),
  noun(
    "f",
    "food",
    "крупа крупи крупі крупу крупою крупі",
    "крупи круп крупам крупи крупами крупах",
  ),
  noun(
    "f",
    "food",
    "ковбаса ковбаси ковбасі ковбасу ковбасою ковбасі",
    "ковбаси ковбас ковбасам ковбаси ковбасами ковбасах",
  ),
  noun("f", "food", "вода води воді воду водою воді", "води вод водам води водами водах"),
  noun(
    "n",
    "food",
    "яблуко яблука яблуку яблуко яблуком яблуці",
    "яблука яблук яблукам яблука яблуками яблуках",
  ),
  noun("p", "electronics", "", "навушники навушників навушникам навушники навушниками навушниках"),
  noun(
    "m",
    "electronics",
    "кабель кабелю кабелю кабель кабелем кабелі",
    "кабелі кабелів кабелям кабелі кабелями кабелях",
  ),
  noun(
    "m",
    "electronics",
    "чохол чохла чохлу чохол чохлом чохлі",
    "чохли чохлів чохлам чохли чохлами чохлах",
  ),
  noun(
    "f",
    "electronics",
    "лампа лампи лампі лампу лампою лампі",
    "лампи ламп лампам лампи лампами лампах",
  ),
  noun(
    "f",
    "electronics",
    "зарядка зарядки зарядці зарядку зарядкою зарядці",
    "зарядки зарядок зарядкам зарядки зарядками зарядках",
  ),
  noun(
    "f",
    "electronics",
    "клавіатура клавіатури клавіатурі клавіатуру клавіатурою клавіатурі",
    "клавіатури клавіатур клавіатурам клавіатури клавіатурами клавіатурах",
  ),
  noun("f", "electronics", "миша миші миші мишу мишею миші", "миші мишей мишам миші мишами мишах"),
  noun(
    "f",
    "electronics",
    "колонка колонки колонці колонку колонкою колонці",
    "колонки колонок колонкам колонки колонками колонках",
  ),
  noun(
    "m",
    "electronics",
    "акумулятор акумулятора акумулятору акумулятор акумулятором акумуляторі",
    "акумулятори акумуляторів акумуляторам акумулятори акумуляторами акумуляторах",
  ),
  noun(
    "m",
    "electronics",
    "роутер роутера роутеру роутер роутером роутері",
    "роутери роутерів роутерам роутери роутерами роутерах",
  ),
  noun(
    "m",
    "electronics",
    "екран екрана екрану екран екраном екрані",
    "екрани екранів екранам екрани екранами екранах",
  ),
  noun(
    "f",
    "stationery",
    "книга книги книзі книгу книгою книзі",
    "книги книг книгам книги книгами книгах",
  ),
  noun(
    "m",
    "stationery",
    "зошит зошита зошиту зошит зошитом зошиті",
    "зошити зошитів зошитам зошити зошитами зошитах",
  ),
  noun(
    "f",
    "stationery",
    "ручка ручки ручці ручку ручкою ручці",
    "ручки ручок ручкам ручки ручками ручках",
  ),
  noun(
    "m",
    "stationery",
    "блокнот блокнота блокноту блокнот блокнотом блокноті",
    "блокноти блокнотів блокнотам блокноти блокнотами блокнотах",
  ),
  noun(
    "m",
    "stationery",
    "олівець олівця олівцю олівець олівцем олівці",
    "олівці олівців олівцям олівці олівцями олівцях",
  ),
  noun(
    "f",
    "stationery",
    "папка папки папці папку папкою папці",
    "папки папок папкам папки папками папках",
  ),
  noun(
    "m",
    "stationery",
    "щоденник щоденника щоденнику щоденник щоденником щоденнику",
    "щоденники щоденників щоденникам щоденники щоденниками щоденниках",
  ),
  noun("p", "stationery", "", "фарби фарб фарбам фарби фарбами фарбах"),
  noun(
    "m",
    "stationery",
    "календар календаря календарю календар календарем календарі",
    "календарі календарів календарям календарі календарями календарях",
  ),
  noun(
    "f",
    "stationery",
    "лінійка лінійки лінійці лінійку лінійкою лінійці",
    "лінійки лінійок лінійкам лінійки лінійками лінійках",
  ),
];

/** Hard-stem adjectives (-ий, -а, -е, -і), the common product-title paradigm. */
export const adjectiveStems: Readonly<Record<Niche, readonly string[]>> = {
  clothes: [
    "класичн",
    "зимов",
    "літн",
    "легк",
    "чоловіч",
    "жіноч",
    "дитяч",
    "бавовнян",
    "вовнян",
    "шкірян",
    "спортивн",
    "тепл",
    "водонепроникн",
    "повсякденн",
    "базов",
    "об'ємн",
  ],
  tools: [
    "професійн",
    "акумуляторн",
    "універсальн",
    "міцн",
    "компактн",
    "хрестов",
    "плоск",
    "ручн",
    "електричн",
    "металев",
    "ергономічн",
    "магнітн",
    "садов",
  ],
  food: [
    "органічн",
    "натуральн",
    "чорн",
    "зелен",
    "кавов",
    "солодк",
    "мигдалев",
    "вівсян",
    "пшеничн",
    "фруктов",
    "домашн",
    "свіж",
    "біл",
  ],
  electronics: [
    "бездротов",
    "портативн",
    "цифров",
    "швидк",
    "універсальн",
    "компактн",
    "ігров",
    "офісн",
    "акумуляторн",
    "водонепроникн",
    "магнітн",
    "дротов",
  ],
  stationery: [
    "шкільн",
    "офісн",
    "лінійн",
    "кольоров",
    "дитяч",
    "шкірян",
    "універсальн",
    "подарунков",
    "навчальн",
    "художн",
  ],
};

type Case = 0 | 1 | 2 | 3 | 4 | 5;
export const adjectiveForm = (stem: string, gender: Gender, caseIndex: Case): string => {
  const endings: Record<Gender, readonly string[]> = {
    m: ["ий", "ого", "ому", "ий", "им", "ому"],
    f: ["а", "ої", "ій", "у", "ою", "ій"],
    n: ["е", "ого", "ому", "е", "им", "ому"],
    p: ["і", "их", "им", "і", "ими", "их"],
  };
  const ending = endings[gender][caseIndex];
  if (ending === undefined) throw new Error("bad case");
  return stem + ending;
};

export const adjectiveLemma = (stem: string): string => `${stem}ий`;
const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export interface CorpusDocument {
  readonly id: string;
  readonly productId: string;
  readonly title: string;
  readonly brandName: string;
  readonly sku: string;
  readonly optionLabels: readonly string[];
  readonly description: string;
  readonly price: number;
}

export interface CorpusProduct {
  readonly id: string;
  readonly nounLemma: string;
  readonly adjectiveLemmas: readonly string[];
  readonly brandName: string;
  readonly title: string;
}

export interface CorpusQuery {
  readonly text: string;
  readonly kind:
    "inflected-noun" | "inflected-noun-adjective" | "nominative" | "typo" | "prefix" | "brand";
  /** Product ids that are relevant by construction. */
  readonly relevant: readonly string[];
}

const brands = [
  "Nordic",
  "Stanley",
  "Bosch",
  "Makita",
  "Ферма",
  "Світанок",
  "Technix",
  "Eco Line",
  "Максима",
  "Orbit",
];
const colors = ["чорний", "білий", "синій", "червоний", "сірий"];
const sizes = ["S", "M", "L", "XL"];
const codes = ["A1", "X200", "Pro 2", "PH2", "500 г", "2 м", "Mini", "Plus", "S3", "Lite"];

export function buildCorpus(productCount = 320): {
  products: CorpusProduct[];
  documents: CorpusDocument[];
  queries: CorpusQuery[];
} {
  const random = mulberry32(20261029);
  const pick = <T>(items: readonly T[]): T => {
    const item = items[Math.floor(random() * items.length)];
    if (item === undefined) throw new Error("empty pick");
    return item;
  };
  const products: CorpusProduct[] = [];
  const documents: CorpusDocument[] = [];
  const niches: Niche[] = ["clothes", "tools", "food", "electronics", "stationery"];
  const seenTitles = new Set<string>();
  for (let index = 0; products.length < productCount; index++) {
    const niche = niches[index % niches.length] ?? "clothes";
    const head = pick(nouns.filter((entry) => entry.niche === niche));
    const stems = adjectiveStems[niche];
    const first = pick(stems);
    const adjectiveStemsUsed = [first];
    if (random() < 0.55) {
      const second = pick(stems);
      if (second !== first) adjectiveStemsUsed.push(second);
    }
    const adjectives = adjectiveStemsUsed.map((stem) => adjectiveForm(stem, head.gender, 0));
    const tail = random() < 0.3 ? ` ${pick(codes)}` : "";
    const title = `${capitalize(head.lemma)} ${adjectives.join(" ")}${tail}`;
    if (seenTitles.has(title)) continue;
    seenTitles.add(title);
    const id = `p${products.length}`;
    const brandName = pick(brands);
    products.push({
      id,
      nounLemma: head.lemma,
      adjectiveLemmas: adjectiveStemsUsed.map(adjectiveLemma),
      brandName,
      title,
    });
    const variantCount = 1 + Math.floor(random() * 3);
    for (let v = 0; v < variantCount; v++) {
      documents.push({
        id: `${id}-v${v}`,
        productId: id,
        title,
        brandName,
        sku: `SKU-${products.length}-${v}`,
        optionLabels: niche === "clothes" ? [pick(sizes), pick(colors)] : [pick(colors)],
        description: "Якісний товар з гарантією та швидкою доставкою",
        price: 10000 + Math.floor(random() * 400000),
      });
    }
  }

  const nounMatches = (entry: Noun, product: CorpusProduct): boolean =>
    product.nounLemma === entry.lemma;
  const relevantTo = (
    entry: Noun | null,
    adjectiveLemmasWanted: readonly string[],
    brandName: string | null,
  ): string[] =>
    products
      .filter(
        (product) =>
          (entry === null || nounMatches(entry, product)) &&
          adjectiveLemmasWanted.every((lemma) => product.adjectiveLemmas.includes(lemma)) &&
          (brandName === null || product.brandName === brandName),
      )
      .map((product) => product.id);

  const usedNouns = nouns.filter((entry) =>
    products.some((product) => nounMatches(entry, product)),
  );
  const queries: CorpusQuery[] = [];
  const nounForm = (entry: Noun, plural: boolean, caseIndex: Case): string | null =>
    (plural || entry.singular.length === 0 ? entry.plural : entry.singular)[caseIndex] ?? null;
  const agreeing = (entry: Noun, plural: boolean): Gender =>
    plural || entry.gender === "p" ? "p" : entry.gender;

  // inflected noun only: not the nominative singular
  while (queries.filter((query) => query.kind === "inflected-noun").length < 30) {
    const entry = pick(usedNouns);
    const plural = entry.singular.length === 0 || random() < 0.4;
    const caseIndex = (1 + Math.floor(random() * 5)) as Case;
    const text = nounForm(entry, plural, plural && random() < 0.5 ? 0 : caseIndex);
    if (text === null || text === entry.lemma) continue;
    if (queries.some((query) => query.text === text)) continue;
    queries.push({ text, kind: "inflected-noun", relevant: relevantTo(entry, [], null) });
  }
  // inflected noun + adjective, both in the same case and number
  while (queries.filter((query) => query.kind === "inflected-noun-adjective").length < 25) {
    const entry = pick(usedNouns);
    const stems = adjectiveStems[entry.niche];
    const stem = pick(stems);
    const plural = entry.singular.length === 0 || random() < 0.4;
    const caseIndex = (random() < 0.5 ? 0 : 1 + Math.floor(random() * 5)) as Case;
    const nounText = nounForm(entry, plural, caseIndex);
    if (nounText === null) continue;
    const adjectiveText = adjectiveForm(stem, agreeing(entry, plural), caseIndex);
    const text = random() < 0.5 ? `${adjectiveText} ${nounText}` : `${nounText} ${adjectiveText}`;
    const relevant = relevantTo(entry, [adjectiveLemma(stem)], null);
    if (relevant.length === 0 || queries.some((query) => query.text === text)) continue;
    queries.push({ text, kind: "inflected-noun-adjective", relevant });
  }
  // control: nominative noun, alone or with a nominative adjective
  while (queries.filter((query) => query.kind === "nominative").length < 15) {
    const entry = pick(usedNouns);
    const withAdjective = random() < 0.5;
    const stem = pick(adjectiveStems[entry.niche]);
    const text = withAdjective
      ? `${entry.lemma} ${adjectiveForm(stem, entry.gender, 0)}`
      : entry.lemma;
    const relevant = relevantTo(entry, withAdjective ? [adjectiveLemma(stem)] : [], null);
    if (relevant.length === 0 || queries.some((query) => query.text === text)) continue;
    queries.push({ text, kind: "nominative", relevant });
  }
  // one-letter typos in a nominative noun (a substituted letter in the middle)
  while (queries.filter((query) => query.kind === "typo").length < 10) {
    const entry = pick(usedNouns);
    if (entry.lemma.length < 6) continue;
    const at = 2 + Math.floor(random() * (entry.lemma.length - 4));
    const text =
      entry.lemma.slice(0, at) + (entry.lemma[at] === "о" ? "а" : "о") + entry.lemma.slice(at + 1);
    if (queries.some((query) => query.text === text)) continue;
    queries.push({ text, kind: "typo", relevant: relevantTo(entry, [], null) });
  }
  // prefixes typed while the shopper is still writing (4 to 5 letters of a noun)
  while (queries.filter((query) => query.kind === "prefix").length < 10) {
    const entry = pick(usedNouns);
    if (entry.lemma.length < 7) continue;
    const text = entry.lemma.slice(0, 4 + Math.floor(random() * 2));
    const relevant = products
      .filter(
        (product) =>
          product.nounLemma.startsWith(text) ||
          product.adjectiveLemmas.some((lemma) => lemma.startsWith(text)),
      )
      .map((product) => product.id);
    if (queries.some((query) => query.text === text)) continue;
    queries.push({ text, kind: "prefix", relevant });
  }
  // brand names, Latin and Cyrillic
  for (const brandName of [
    "Nordic",
    "Stanley",
    "Bosch",
    "Makita",
    "Ферма",
    "Світанок",
    "Technix",
    "Orbit",
    "Максима",
    "Eco Line",
  ]) {
    queries.push({
      text: brandName.toLowerCase(),
      kind: "brand",
      relevant: relevantTo(null, [], brandName),
    });
  }
  return { products, documents, queries };
}
