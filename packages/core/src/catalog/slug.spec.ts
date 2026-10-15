import { describe, expect, it } from "vitest";
import {
  generateUniqueSlug,
  isValidSlug,
  slugify,
  slugLookupPrefix,
  transliterateUkrainian,
  validateSlug,
} from "./slug.js";

describe("validateSlug / isValidSlug", () => {
  it("accepts lowercase latin words joined by single hyphens", () => {
    for (const slug of ["a", "futbolka", "futbolka-basic", "vykrutka-ph2-100", "0", "a1-b2"]) {
      expect(isValidSlug(slug)).toBe(true);
      expect(validateSlug(slug)).toEqual({ ok: true });
    }
  });

  it("accepts exactly 160 characters and rejects 161", () => {
    expect(validateSlug("a".repeat(160))).toEqual({ ok: true });
    expect(validateSlug("a".repeat(161))).toEqual({ ok: false, reason: "too_long" });
  });

  it("rejects an empty slug", () => {
    expect(validateSlug("")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects other shapes", () => {
    for (const slug of [
      "-a",
      "a-",
      "a--b",
      "A",
      "a_b",
      "a b",
      "a/b",
      "футболка",
      "a.b",
      " a",
      "a\n",
    ]) {
      expect(isValidSlug(slug)).toBe(false);
      expect(validateSlug(slug)).toEqual({ ok: false, reason: "invalid_format" });
    }
  });
});

describe("transliterateUkrainian (KMU resolution 55/2010)", () => {
  const cases: readonly (readonly [string, string])[] = [
    ["Футболка", "Futbolka"],
    ["Відвертка", "Vidvertka"],
    ["Зелений", "Zelenyi"],
    ["Згорток", "Zghortok"],
    ["Їжак", "Yizhak"],
    ["Юрій", "Yurii"],
    ["Мʼясо", "Miaso"],
    ["Ємність", "Yemnist"],
    ["Київ", "Kyiv"],
    ["Яблуко", "Yabluko"],
    ["Моя", "Moia"],
    ["Йод", "Yod"],
    ["Мій", "Mii"],
    ["Українка", "Ukrainka"],
    ["Щука", "Shchuka"],
    ["Чашка", "Chashka"],
    ["Жук", "Zhuk"],
    ["Хліб", "Khlib"],
    ["Цукор", "Tsukor"],
    ["Ґанок", "Ganok"],
    ["Голова", "Holova"],
    ["Сьогодні", "Sohodni"],
    ["Сіль", "Sil"],
    ["Розгорнути", "Rozghornuty"],
    ["Пʼятниця", "Piatnytsia"],
  ];

  it.each(cases)("%s -> %s", (source, expected) => {
    expect(transliterateUkrainian(source)).toBe(expected);
  });

  it("maps the zg digraph to zgh in any case, so it is not read as zh", () => {
    expect(transliterateUkrainian("зг")).toBe("zgh");
    expect(transliterateUkrainian("ЗГ")).toBe("ZGh");
    expect(transliterateUkrainian("Згода")).toBe("Zghoda");
    expect(transliterateUkrainian("зґ")).toBe("zg");
    expect(transliterateUkrainian("жг")).toBe("zhh");
  });

  it("maps є ю я ї й differently at the start of a word and elsewhere", () => {
    expect(transliterateUkrainian("є ю я ї й")).toBe("ye yu ya yi y");
    expect(transliterateUkrainian("аєаюаяаїай")).toBe("aieaiuaiaaiai");
    expect(transliterateUkrainian("так-є")).toBe("tak-ye");
  });

  it("treats a letter after an apostrophe as inside the word", () => {
    expect(transliterateUkrainian("з'їзд")).toBe("zizd");
    expect(transliterateUkrainian("Мʼясо")).toBe("Miaso");
    for (const apostrophe of ["'", "’", "ʼ", "`", "´", "‘"]) {
      expect(transliterateUkrainian(`м${apostrophe}яч`)).toBe("miach");
    }
  });

  it("drops the soft sign", () => {
    expect(transliterateUkrainian("ь")).toBe("");
    expect(transliterateUkrainian("Львів")).toBe("Lviv");
    expect(transliterateUkrainian("Ємність")).toBe("Yemnist");
  });

  it("keeps the capital of multi-letter results on the first letter only", () => {
    expect(transliterateUkrainian("Щ")).toBe("Shch");
    expect(transliterateUkrainian("Ж")).toBe("Zh");
  });

  it("leaves non-Cyrillic characters untouched", () => {
    expect(transliterateUkrainian("Basic T-shirt 2")).toBe("Basic T-shirt 2");
  });
});

describe("slugify", () => {
  it("builds a slug from a Ukrainian title", () => {
    expect(slugify("Футболка")).toBe("futbolka");
    expect(slugify("Чоловіча футболка Basic")).toBe("cholovicha-futbolka-basic");
    expect(slugify("Викрутка PH2 100")).toBe("vykrutka-ph2-100");
    expect(slugify("Відвертка")).toBe("vidvertka");
    expect(slugify("Зелений Згорток")).toBe("zelenyi-zghortok");
    expect(slugify("Їжак та Юрій")).toBe("yizhak-ta-yurii");
    expect(slugify("Мʼясо")).toBe("miaso");
  });

  it("handles uppercase titles", () => {
    expect(slugify("ЗГОРТОК")).toBe("zghortok");
    expect(slugify("ЇЖАК")).toBe("yizhak");
  });

  it("collapses runs of non-alphanumerics to one hyphen and trims the ends", () => {
    expect(slugify("  --Тест!!  ")).toBe("test");
    expect(slugify("Футболка / Basic, (червона)")).toBe("futbolka-basic-chervona");
    expect(slugify("a___b...c")).toBe("a-b-c");
  });

  it("keeps digits", () => {
    expect(slugify("Викрутка 2026")).toBe("vykrutka-2026");
  });

  it("accepts Latin input unchanged apart from normalization", () => {
    expect(slugify("basic-t-shirt")).toBe("basic-t-shirt");
    expect(slugify("Basic T-Shirt")).toBe("basic-t-shirt");
    expect(slugify("Men's shirt")).toBe("mens-shirt");
    expect(slugify("Café Déjà vu")).toBe("cafe-deja-vu");
  });

  it("returns an empty string when nothing alphanumeric is left", () => {
    expect(slugify("")).toBe("");
    expect(slugify("   ")).toBe("");
    expect(slugify("!!! ??? ---")).toBe("");
    expect(slugify("😀")).toBe("");
  });

  it("treats Cyrillic letters outside the Ukrainian alphabet as separators", () => {
    expect(slugify("ы")).toBe("");
  });

  it("is limited to 160 characters and never ends with a hyphen", () => {
    expect(slugify("a".repeat(200))).toBe("a".repeat(160));
    const long = slugify(`${"a".repeat(159)} bbbb`);
    expect(long).toBe("a".repeat(159));
    expect(long.length).toBeLessThanOrEqual(160);
  });

  it("always produces a valid slug or an empty string", () => {
    for (const title of ["Футболка Basic", "Їжак!!!", "Мʼясо 2", "x", "A--B"]) {
      expect(isValidSlug(slugify(title))).toBe(true);
    }
  });

  it("is deterministic", () => {
    expect(slugify("Футболка Basic")).toBe(slugify("Футболка Basic"));
  });
});

describe("generateUniqueSlug", () => {
  it("returns the plain slug when it is free", () => {
    expect(generateUniqueSlug("Футболка", new Set())).toEqual({ ok: true, slug: "futbolka" });
  });

  it("appends -2, -3, ... on collision", () => {
    expect(generateUniqueSlug("Футболка", new Set(["futbolka"]))).toEqual({
      ok: true,
      slug: "futbolka-2",
    });
    expect(generateUniqueSlug("Футболка", new Set(["futbolka", "futbolka-2"]))).toEqual({
      ok: true,
      slug: "futbolka-3",
    });
  });

  it("takes the first free suffix even when a later one is taken", () => {
    expect(generateUniqueSlug("Футболка", new Set(["futbolka", "futbolka-3"]))).toEqual({
      ok: true,
      slug: "futbolka-2",
    });
  });

  it("keeps the result within 160 characters when a suffix is added", () => {
    const title = "a".repeat(200);
    const result = generateUniqueSlug(title, new Set(["a".repeat(160)]));
    expect(result).toEqual({ ok: true, slug: `${"a".repeat(158)}-2` });
    if (result.ok) {
      expect(isValidSlug(result.slug)).toBe(true);
    }
  });

  it("fails loudly when the title has no usable characters", () => {
    expect(generateUniqueSlug("!!!", new Set())).toEqual({ ok: false, reason: "empty_slug" });
  });

  it("does not mutate the taken set", () => {
    const taken = new Set(["futbolka"]);
    generateUniqueSlug("Футболка", taken);
    expect([...taken]).toEqual(["futbolka"]);
  });
});

describe("slugLookupPrefix", () => {
  it("is empty when the title has no usable characters", () => {
    expect(slugLookupPrefix("!!!")).toBe("");
  });

  it("is the whole slug for a short title", () => {
    expect(slugLookupPrefix("Футболка")).toBe("futbolka");
  });

  it("matches every slug generateUniqueSlug can produce, also for a 160 character slug", () => {
    // A caller reads the taken slugs with a `startsWith(prefix)` query, like the repositories do.
    const store = new Set<string>();
    const created: string[] = [];
    for (const title of ["a".repeat(200), "ab ".repeat(100), `${"a".repeat(157)} b c`]) {
      store.clear();
      created.length = 0;
      for (let round = 0; round < 12; round += 1) {
        const prefix = slugLookupPrefix(title);
        const taken = new Set([...store].filter((slug) => slug.startsWith(prefix)));
        const result = generateUniqueSlug(title, taken);
        expect(result.ok).toBe(true);
        if (!result.ok) {
          return;
        }
        expect(store.has(result.slug)).toBe(false);
        expect(isValidSlug(result.slug)).toBe(true);
        store.add(result.slug);
        created.push(result.slug);
      }
      expect(new Set(created).size).toBe(12);
    }
  });
});
